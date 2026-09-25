mod worker;
use serde::Serialize;
use serde_json::Value;
use sqlx::PgConnection;
pub use worker::{FIELDS, Handler, Worker, WorkerPolicy, worker_bind};

pub struct NewJob<'a> {
    pub kind: &'a str,
    pub schema_version: i32,
    pub payload: Value,
    pub correlation_id: &'a str,
}

/// Enqueue in the business transaction; workers only observe committed work.
pub async fn enqueue(
    connection: &mut PgConnection,
    job: NewJob<'_>,
) -> Result<String, sqlx::Error> {
    let id = uuid::Uuid::now_v7().to_string();
    sqlx::query("INSERT INTO saas_core.jobs (id, kind, schema_version, payload, correlation_id) VALUES ($1::uuid, $2, $3, $4, $5)")
        .bind(&id).bind(job.kind).bind(job.schema_version).bind(job.payload).bind(job.correlation_id).execute(connection).await?;
    Ok(id)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct JobStatus {
    pub id: String,
    pub status: String,
    pub last_error: Option<String>,
}

pub async fn statuses(
    connection: &mut PgConnection,
    ids: &[String],
) -> Result<Vec<JobStatus>, sqlx::Error> {
    sqlx::query_as("SELECT id::text, status, last_error FROM saas_core.jobs WHERE id = ANY($1::text[]::uuid[])")
        .bind(ids).fetch_all(connection).await
}

#[derive(Clone, sqlx::FromRow)]
pub struct Lease {
    pub id: String,
    pub kind: String,
    pub schema_version: i32,
    pub payload: Value,
    pub lease_token: String,
    pub correlation_id: String,
}

#[derive(Debug)]
pub enum JobError {
    Permanent(&'static str),
    Transient(&'static str),
    LostLease,
}
impl From<sqlx::Error> for JobError {
    fn from(_: sqlx::Error) -> Self {
        Self::Transient("jobs.database_unavailable")
    }
}

pub async fn claim(
    pool: &sqlx::PgPool,
    kinds: &[&str],
    worker: &str,
    lease_secs: u32,
) -> Result<Option<Lease>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE saas_core.jobs SET status = 'failed', last_error = 'jobs.attempts_exhausted', updated_at = now() WHERE id IN (SELECT id FROM saas_core.jobs WHERE status = 'running' AND lease_expires_at <= clock_timestamp() AND attempts >= max_attempts AND kind = ANY($1) ORDER BY lease_expires_at, id FOR UPDATE SKIP LOCKED LIMIT 25)")
        .bind(kinds).execute(&mut *tx).await?;
    let lease = sqlx::query_as("WITH candidate AS (SELECT id FROM saas_core.jobs WHERE kind = ANY($1) AND attempts < max_attempts AND ((status IN ('queued', 'retry_wait') AND scheduled_at <= clock_timestamp()) OR (status = 'running' AND lease_expires_at <= clock_timestamp())) ORDER BY scheduled_at, id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE saas_core.jobs j SET status = 'running', lease_token = $2::uuid, locked_by = $3, lease_expires_at = clock_timestamp() + make_interval(secs => $4), attempts = attempts + 1, updated_at = now() FROM candidate c WHERE j.id = c.id RETURNING j.id::text, j.kind, j.schema_version, j.payload, j.lease_token::text, j.correlation_id")
        .bind(kinds).bind(uuid::Uuid::now_v7().to_string()).bind(worker).bind(f64::from(lease_secs)).fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(lease)
}

impl Lease {
    /// Fence before changing business results; keep this lock through their commit.
    pub async fn lock_current(&self, connection: &mut PgConnection) -> Result<(), JobError> {
        let present: Option<String> = sqlx::query_scalar("SELECT id::text FROM saas_core.jobs WHERE id = $1::uuid AND status = 'running' AND lease_token = $2::uuid AND lease_expires_at > clock_timestamp() FOR UPDATE")
            .bind(&self.id).bind(&self.lease_token).fetch_optional(connection).await?;
        present.map(|_| ()).ok_or(JobError::LostLease)
    }
    pub async fn succeed(&self, connection: &mut PgConnection) -> Result<(), JobError> {
        let done = sqlx::query("UPDATE saas_core.jobs SET status = 'succeeded', last_error = NULL, updated_at = now() WHERE id = $1::uuid AND status = 'running' AND lease_token = $2::uuid AND lease_expires_at > clock_timestamp()")
            .bind(&self.id).bind(&self.lease_token).execute(connection).await?;
        if done.rows_affected() == 1 {
            Ok(())
        } else {
            Err(JobError::LostLease)
        }
    }
    pub async fn heartbeat(&self, pool: &sqlx::PgPool, lease_secs: u32) -> Result<(), JobError> {
        let renewed = sqlx::query("UPDATE saas_core.jobs SET lease_expires_at = clock_timestamp() + make_interval(secs => $3), updated_at = now() WHERE id = $1::uuid AND status = 'running' AND lease_token = $2::uuid AND lease_expires_at > clock_timestamp()")
            .bind(&self.id).bind(&self.lease_token).bind(f64::from(lease_secs)).execute(pool).await?;
        if renewed.rows_affected() == 1 {
            Ok(())
        } else {
            Err(JobError::LostLease)
        }
    }
    /// Only safe, static codes enter the persisted error summary.
    pub async fn fail(&self, pool: &sqlx::PgPool, error: &JobError) -> Result<(), sqlx::Error> {
        let (code, transient) = match error {
            JobError::Permanent(code) => (*code, false),
            JobError::Transient(code) => (*code, true),
            JobError::LostLease => return Ok(()),
        };
        sqlx::query("UPDATE saas_core.jobs SET status = CASE WHEN $4 AND attempts < max_attempts THEN 'retry_wait' ELSE 'failed' END, scheduled_at = clock_timestamp() + make_interval(secs => random() * LEAST(900.0, power(2.0, attempts))), last_error = $3, updated_at = now() WHERE id = $1::uuid AND status = 'running' AND lease_token = $2::uuid AND lease_expires_at > clock_timestamp()")
            .bind(&self.id).bind(&self.lease_token).bind(code).bind(transient).execute(pool).await?;
        Ok(())
    }
}
