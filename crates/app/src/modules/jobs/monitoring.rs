use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema, sqlx::FromRow)]
pub struct JobAttemptCount {
    pub kind: String,
    pub outcome: String,
    pub count: i64,
}
#[derive(Serialize, ToSchema)]
pub struct JobMonitoringSummary {
    pub waiting: i64,
    pub running: i64,
    pub failed: i64,
    pub oldest_wait_seconds: Option<f64>,
    pub attempts: Vec<JobAttemptCount>,
}

/// Current queue state and completed attempts in the requested reporting window.
pub async fn monitoring_summary(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<JobMonitoringSummary, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    let (waiting, running, failed, oldest_wait_seconds) = sqlx::query_as::<_, (i64, i64, i64, Option<f64>)>(
        "SELECT count(*) FILTER (WHERE status IN ('queued', 'retry_wait')), count(*) FILTER (WHERE status = 'running'), count(*) FILTER (WHERE status = 'failed'), EXTRACT(EPOCH FROM (now() - min(scheduled_at) FILTER (WHERE status IN ('queued', 'retry_wait') AND scheduled_at <= now())))::float8 FROM saas_core.jobs"
    ).fetch_one(&mut *tx).await?;
    let attempts = sqlx::query_as("SELECT j.kind, a.status AS outcome, count(*) AS count FROM saas_core.job_attempts a JOIN saas_core.jobs j ON j.id = a.job_id WHERE a.ended_at >= $1 GROUP BY j.kind, a.status ORDER BY j.kind, a.status LIMIT 128")
        .bind(since).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(JobMonitoringSummary {
        waiting,
        running,
        failed,
        oldest_wait_seconds,
        attempts,
    })
}
