use super::{Failure, Ticket, Tickets, application};
use crate::{
    http::{ApiPath, RequestId},
    modules::{
        audit, files, idempotency,
        identity::{self, CredentialRef},
        jobs::{self, Handler, JobError, Lease, Maintenance},
        notifications,
        organization::{self, MemberRole},
    },
};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use saas_platform::config::AuthSettings;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool};
use std::{
    future::Future,
    sync::{Arc, LazyLock},
    time::Duration,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use utoipa::{OpenApi, ToSchema};

pub const MAX_EXPORT_ATTACHMENTS: usize = 8;
pub const MAX_EXPORT_BYTES: i64 = 64 * 1024;
pub const EXPORT_RETENTION_SECS: u32 = 3600;
const DB_BUDGET: Duration = Duration::from_secs(3);
const JOB_BUDGET: Duration = Duration::from_secs(120);
const KIND: &str = "tickets.export";
static SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(2)));

#[derive(Serialize, ToSchema)]
pub struct TicketExport {
    pub id: String,
    pub job_id: String,
    pub status: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct ExportRow {
    id: String,
    ticket_id: String,
    requested_by: String,
    credential: serde_json::Value,
    job_id: String,
    snapshot: Option<serde_json::Value>,
    file_id: Option<String>,
    expires_at: DateTime<Utc>,
}

const COLUMNS: &str = "id::text, ticket_id::text, requested_by::text, credential, job_id::text, snapshot, file_id::text, expires_at";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    export_id: String,
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    ticket: Ticket,
    attachments: Vec<files::FileSnapshot>,
}

#[derive(Serialize)]
struct AttachmentMetadata<'a> {
    id: &'a str,
    file_name: &'a str,
    content_type: &'a str,
    size: i64,
    sha256: &'a str,
}

#[derive(Serialize)]
struct ExportDocument<'a> {
    ticket: &'a Ticket,
    attachments: Vec<AttachmentMetadata<'a>>,
}

fn document_bytes(snapshot: &Snapshot) -> Result<Vec<u8>, Failure> {
    if snapshot.attachments.len() > MAX_EXPORT_ATTACHMENTS
        || snapshot.ticket.title.chars().count() > 200
        || snapshot.ticket.description.len() > 8192
    {
        return Err(Failure::ExportTooLarge);
    }
    let document = ExportDocument {
        ticket: &snapshot.ticket,
        attachments: snapshot
            .attachments
            .iter()
            .map(|file| AttachmentMetadata {
                id: &file.id,
                file_name: &file.file_name,
                content_type: &file.content_type,
                size: file.size,
                sha256: &file.sha256,
            })
            .collect(),
    };
    let bytes = serde_json::to_vec_pretty(&document).map_err(|_| Failure::Unavailable)?;
    if bytes.len() as i64 > MAX_EXPORT_BYTES {
        return Err(Failure::ExportTooLarge);
    }
    Ok(bytes)
}

pub(super) fn routes() -> Router<Tickets> {
    Router::new()
        .route("/api/v1/tickets/{id}/exports", post(request_export))
        .route("/api/v1/tickets/{id}/exports/{export_id}", get(get_export))
        .route(
            "/api/v1/tickets/{id}/exports/{export_id}/download",
            get(download_export),
        )
}

#[derive(OpenApi)]
#[openapi(paths(request_export, get_export, download_export))]
struct ExportApi;

pub(super) fn openapi() -> utoipa::openapi::OpenApi {
    ExportApi::openapi()
}

async fn http_budget<T>(work: impl Future<Output = Result<T, Failure>>) -> Result<T, Failure> {
    tokio::time::timeout(DB_BUDGET, work)
        .await
        .map_err(|_| Failure::Unavailable)?
}

async fn job_budget<T>(work: impl Future<Output = Result<T, JobError>>) -> Result<T, JobError> {
    tokio::time::timeout(DB_BUDGET, work)
        .await
        .map_err(|_| JobError::Transient("tickets.export_database_timeout"))?
}

async fn information(
    connection: &mut PgConnection,
    row: &ExportRow,
) -> Result<TicketExport, Failure> {
    let jobs = jobs::statuses(connection, std::slice::from_ref(&row.job_id)).await?;
    let job = jobs.into_iter().next().ok_or(Failure::Unavailable)?;
    Ok(TicketExport {
        id: row.id.clone(),
        job_id: row.job_id.clone(),
        status: if row.expires_at <= Utc::now() {
            "expired".into()
        } else {
            job.status
        },
        expires_at: row.expires_at,
    })
}

#[utoipa::path(post, path = "/api/v1/tickets/{id}/exports", operation_id = "requestTicketExport", tag = "Tickets", params(("id" = String, Path), ("x-csrf-token" = String, Header), ("idempotency-key" = String, Header)), responses((status = 202, body = TicketExport), (status = 400, body = crate::http::ApiErrorResponse), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 409, body = crate::http::ApiErrorResponse), (status = 413, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn request_export(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiPath(ticket_id): ApiPath<String>,
) -> Response {
    let actor = match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await
    {
        Ok(session) => session.user,
        Err(response) => return response,
    };
    if state.files.is_none() {
        return Failure::Unavailable.response(id);
    }
    if uuid::Uuid::parse_str(&ticket_id).is_err() {
        return Failure::NotFound.response(id);
    }
    let Some(key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
    else {
        return Failure::InvalidKey.response(id);
    };
    match http_budget(create_export(
        &state, &actor.id, &ticket_id, key, &headers, &id.0,
    ))
    .await
    {
        Ok(export) => (StatusCode::ACCEPTED, Json(export)).into_response(),
        Err(error) => error.response(id),
    }
}

// region:enqueue-export
async fn create_export(
    state: &Tickets,
    actor_id: &str,
    ticket_id: &str,
    key: &str,
    headers: &HeaderMap,
    request_id: &str,
) -> Result<TicketExport, Failure> {
    let mut tx = state.pool.begin().await?;
    let ticket = application::authorized(&mut tx, actor_id, ticket_id, true).await?;
    let credential = identity::background_credential(&mut tx, &state.auth, headers, actor_id)
        .await?
        .ok_or(Failure::Unauthorized)?;
    if !identity::credential_is_current(&mut tx, &state.auth, actor_id, &credential).await? {
        return Err(Failure::Unauthorized);
    }
    let fingerprint = idempotency::fingerprint(&())?;
    let scope = format!("POST /api/v1/tickets/{ticket_id}/exports");
    let attempt = idempotency::Attempt {
        actor_id,
        scope: &scope,
        key,
        fingerprint: &fingerprint,
    };
    let export_id = if let Some(saved) = idempotency::claim(&mut tx, &attempt).await? {
        saved["export_id"]
            .as_str()
            .ok_or(Failure::Unavailable)?
            .to_owned()
    } else {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM support.exports WHERE ticket_id = $1::uuid AND (snapshot IS NOT NULL OR file_id IS NOT NULL)",
        )
        .bind(ticket_id)
        .fetch_one(&mut *tx)
        .await?;
        if count >= 50 {
            return Err(Failure::ExportLimit);
        }
        let ids: Vec<String> = sqlx::query_scalar("SELECT file_id::text FROM support.uploads WHERE ticket_id = $1::uuid AND published ORDER BY file_id LIMIT $2")
            .bind(ticket_id).bind(MAX_EXPORT_ATTACHMENTS as i64 + 1).fetch_all(&mut *tx).await?;
        if ids.len() > MAX_EXPORT_ATTACHMENTS {
            return Err(Failure::ExportTooLarge);
        }
        let snapshot = Snapshot {
            ticket,
            attachments: files::snapshots(&mut tx, &ids).await?,
        };
        document_bytes(&snapshot)?;
        let export_id = uuid::Uuid::now_v7().to_string();
        let job_id = jobs::enqueue(
            &mut tx,
            jobs::NewJob {
                kind: KIND,
                schema_version: 1,
                max_attempts: 3,
                payload: serde_json::to_value(Payload {
                    export_id: export_id.clone(),
                })
                .map_err(|_| Failure::Unavailable)?,
                correlation_id: request_id,
            },
        )
        .await?;
        notifications::on_job_outcome(
            &mut tx,
            &job_id,
            notifications::JobNotification {
                recipient_id: actor_id,
                event_key: &format!("tickets.export:{export_id}"),
                subject: "Ticket export",
                target: notifications::NotificationTarget {
                    kind: KIND.into(),
                    resource_id: export_id.clone(),
                    context: [("ticket_id".into(), ticket_id.into())].into(),
                },
            },
        )
        .await?;
        sqlx::query("INSERT INTO support.exports (id, ticket_id, requested_by, credential, job_id, snapshot, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, clock_timestamp() + make_interval(secs => $7))")
            .bind(&export_id).bind(ticket_id).bind(actor_id)
            .bind(serde_json::to_value(credential).map_err(|_| Failure::Unavailable)?)
            .bind(job_id).bind(serde_json::to_value(snapshot).map_err(|_| Failure::Unavailable)?)
            .bind(f64::from(EXPORT_RETENTION_SECS)).execute(&mut *tx).await?;
        audit::append(
            &mut tx,
            audit::Event {
                actor_id,
                action: "tickets.export.request",
                resource_type: KIND,
                resource_id: &export_id,
                source: audit::Source::Request(request_id),
                subject_user_id: None,
            },
        )
        .await?;
        idempotency::complete(
            &mut tx,
            &attempt,
            serde_json::json!({"export_id":export_id}),
        )
        .await?;
        export_id
    };
    let row: ExportRow = sqlx::query_as(&format!("SELECT {COLUMNS} FROM support.exports WHERE id = $1::uuid AND ticket_id = $2::uuid AND requested_by = $3::uuid"))
        .bind(export_id).bind(ticket_id).bind(actor_id).fetch_optional(&mut *tx).await?.ok_or(Failure::NotFound)?;
    let info = information(&mut tx, &row).await?;
    tx.commit().await?;
    Ok(info)
}
// endregion:enqueue-export

async fn authorized_export(
    connection: &mut PgConnection,
    actor_id: &str,
    ticket_id: &str,
    export_id: &str,
) -> Result<ExportRow, Failure> {
    let row: ExportRow = sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM support.exports WHERE id = $1::uuid AND ticket_id = $2::uuid"
    ))
    .bind(export_id)
    .bind(ticket_id)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or(Failure::NotFound)?;
    let members =
        organization::lock_memberships(connection, &[actor_id.into(), row.requested_by.clone()])
            .await?;
    let actor = members
        .iter()
        .find(|member| member.user_id == actor_id && member.active)
        .ok_or(Failure::Forbidden)?;
    if actor_id != row.requested_by && !matches!(actor.role, MemberRole::Owner | MemberRole::Admin)
    {
        return Err(Failure::NotFound);
    }
    application::authorized(connection, actor_id, ticket_id, false).await?;
    application::authorized(connection, &row.requested_by, ticket_id, false).await?;
    sqlx::query_as(&format!("SELECT {COLUMNS} FROM support.exports WHERE id = $1::uuid AND ticket_id = $2::uuid FOR SHARE"))
        .bind(export_id).bind(ticket_id).fetch_optional(connection).await?.ok_or(Failure::NotFound)
}

#[utoipa::path(get, path = "/api/v1/tickets/{id}/exports/{export_id}", operation_id = "getTicketExport", tag = "Tickets", params(("id" = String, Path), ("export_id" = String, Path)), responses((status = 200, body = TicketExport), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn get_export(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiPath((ticket_id, export_id)): ApiPath<(String, String)>,
) -> Response {
    let actor =
        match identity::require_session(&state.pool, &state.auth, &headers, &id, false).await {
            Ok(session) => session.user,
            Err(response) => return response,
        };
    if uuid::Uuid::parse_str(&ticket_id).is_err() || uuid::Uuid::parse_str(&export_id).is_err() {
        return Failure::NotFound.response(id);
    }
    let read = async {
        let mut tx = state.pool.begin().await?;
        let row = authorized_export(&mut tx, &actor.id, &ticket_id, &export_id).await?;
        let export = information(&mut tx, &row).await?;
        tx.commit().await?;
        Ok(export)
    };
    match http_budget(read).await {
        Ok(export) => Json(export).into_response(),
        Err(error) => error.response(id),
    }
}

#[utoipa::path(get, path = "/api/v1/tickets/{id}/exports/{export_id}/download", operation_id = "downloadTicketExport", tag = "Tickets", params(("id" = String, Path), ("export_id" = String, Path)), responses((status = 200, body = files::DownloadCapability), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 409, body = crate::http::ApiErrorResponse), (status = 410, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn download_export(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiPath((ticket_id, export_id)): ApiPath<(String, String)>,
) -> Response {
    let actor =
        match identity::require_session(&state.pool, &state.auth, &headers, &id, false).await {
            Ok(session) => session.user,
            Err(response) => return response,
        };
    let Some(files) = state.files.clone() else {
        return Failure::Unavailable.response(id);
    };
    if uuid::Uuid::parse_str(&ticket_id).is_err() || uuid::Uuid::parse_str(&export_id).is_err() {
        return Failure::NotFound.response(id);
    }
    let download = async {
        let mut tx = state.pool.begin().await?;
        let row = authorized_export(&mut tx, &actor.id, &ticket_id, &export_id).await?;
        let remaining = (row.expires_at - Utc::now()).num_seconds();
        if remaining <= 0 {
            return Err(Failure::ExportExpired);
        }
        let info = information(&mut tx, &row).await?;
        if info.status != "succeeded" {
            return Err(Failure::ExportNotReady);
        }
        let file_id = row.file_id.ok_or(Failure::ExportNotReady)?;
        let mut files = files;
        files.policy.download_secs = files.policy.download_secs.min(remaining as u32);
        let capability = files.download(&mut tx, &file_id, false).await?;
        if Utc::now() >= row.expires_at || capability.request.expires_at > row.expires_at {
            return Err(Failure::ExportExpired);
        }
        tx.commit().await?;
        Ok(capability)
    };
    match http_budget(download).await {
        Ok(capability) => Json(capability).into_response(),
        Err(error) => error.response(id),
    }
}

fn access_error(error: Failure) -> JobError {
    match error {
        Failure::Unavailable => JobError::Transient("tickets.export_database_unavailable"),
        Failure::ExportTooLarge => JobError::Permanent("tickets.export_limit"),
        _ => JobError::Permanent("tickets.export_access_revoked"),
    }
}

fn file_error(error: files::Error) -> JobError {
    match error {
        files::Error::NotFound | files::Error::ObjectMissing => {
            JobError::Permanent("tickets.export_input_missing")
        }
        files::Error::Expired => JobError::Permanent("tickets.export_expired"),
        files::Error::InvalidInput | files::Error::Rejected | files::Error::TooLarge => {
            JobError::Permanent("tickets.export_input_invalid")
        }
        _ => JobError::Transient("tickets.export_storage_unavailable"),
    }
}

async fn authorize_work(
    connection: &mut PgConnection,
    auth: &AuthSettings,
    row: &ExportRow,
    snapshot: &Snapshot,
) -> Result<(), JobError> {
    if row.expires_at <= Utc::now() {
        return Err(JobError::Permanent("tickets.export_expired"));
    }
    if snapshot.ticket.id != row.ticket_id {
        return Err(JobError::Permanent("tickets.export_invalid_snapshot"));
    }
    application::authorized(connection, &row.requested_by, &row.ticket_id, false)
        .await
        .map_err(access_error)?;
    let credential: CredentialRef = serde_json::from_value(row.credential.clone())
        .map_err(|_| JobError::Permanent("tickets.export_invalid_snapshot"))?;
    if !identity::credential_is_current(connection, auth, &row.requested_by, &credential).await? {
        return Err(JobError::Permanent("tickets.export_credential_revoked"));
    }
    let ids = snapshot
        .attachments
        .iter()
        .map(|file| file.id.clone())
        .collect::<Vec<_>>();
    let associated: i64 = sqlx::query_scalar("SELECT count(*) FROM support.uploads WHERE ticket_id = $1::uuid AND published AND file_id = ANY($2::text[]::uuid[])")
        .bind(&row.ticket_id).bind(&ids).fetch_one(&mut *connection).await?;
    if associated != ids.len() as i64 {
        return Err(JobError::Permanent("tickets.export_input_changed"));
    }
    let current = files::snapshots(connection, &ids)
        .await
        .map_err(file_error)?;
    for (current, saved) in current.iter().zip(&snapshot.attachments) {
        if current.id != saved.id
            || current.bucket != saved.bucket
            || current.object_key != saved.object_key
            || current.size != saved.size
            || current.sha256 != saved.sha256
        {
            return Err(JobError::Permanent("tickets.export_input_changed"));
        }
    }
    Ok(())
}

struct Artifact {
    directory: tempfile::TempDir,
    path: std::path::PathBuf,
    size: i64,
    sha256: String,
    _permit: OwnedSemaphorePermit,
}

fn artifact(bytes: Vec<u8>, permit: OwnedSemaphorePermit) -> Result<Artifact, JobError> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("saas-ticket-export-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o700));
    }
    let directory = builder
        .tempdir()
        .map_err(|_| JobError::Transient("tickets.export_disk_unavailable"))?;
    let path = directory.path().join("ticket.json");
    std::fs::write(&path, &bytes)
        .map_err(|_| JobError::Transient("tickets.export_disk_unavailable"))?;
    Ok(Artifact {
        directory,
        path,
        size: bytes.len() as i64,
        sha256: hex::encode(Sha256::digest(&bytes)),
        _permit: permit,
    })
}

struct ExportHandler {
    pool: PgPool,
    files: files::FileService,
    auth: AuthSettings,
}

// region:export-handler
#[async_trait::async_trait]
impl Handler for ExportHandler {
    fn kind(&self) -> &'static str {
        KIND
    }

    async fn run(&self, lease: &Lease) -> Result<(), JobError> {
        let mut candidate = None;
        let result = tokio::time::timeout(JOB_BUDGET, self.process(lease, &mut candidate))
            .await
            .unwrap_or(Err(JobError::Transient("tickets.export_timeout")));
        if result.is_err()
            && let Some(candidate) = candidate
        {
            let abandon = async {
                let mut tx = self.pool.begin().await?;
                self.files
                    .abandon(&mut tx, &candidate, false)
                    .await
                    .map_err(file_error)?;
                tx.commit().await?;
                Ok(())
            };
            let _ = job_budget(abandon).await;
        }
        result
    }
}

impl ExportHandler {
    async fn process(
        &self,
        lease: &Lease,
        candidate: &mut Option<files::CompletionAttempt>,
    ) -> Result<(), JobError> {
        if lease.kind != KIND || lease.schema_version != 1 {
            return Err(JobError::Permanent("tickets.export_unknown_payload"));
        }
        let payload: Payload = serde_json::from_value(lease.payload.clone())
            .map_err(|_| JobError::Permanent("tickets.export_unknown_payload"))?;
        if uuid::Uuid::parse_str(&payload.export_id).is_err() {
            return Err(JobError::Permanent("tickets.export_unknown_payload"));
        }
        let permit = SLOTS
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| JobError::Transient("tickets.export_busy"))?;
        let load = async {
            let mut tx = self.pool.begin().await?;
            let row: ExportRow = sqlx::query_as(&format!(
                "SELECT {COLUMNS} FROM support.exports WHERE id = $1::uuid AND job_id = $2::uuid"
            ))
            .bind(&payload.export_id)
            .bind(&lease.id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(JobError::Permanent("tickets.export_source_missing"))?;
            let snapshot: Snapshot = serde_json::from_value(
                row.snapshot
                    .clone()
                    .ok_or(JobError::Permanent("tickets.export_expired"))?,
            )
            .map_err(|_| JobError::Permanent("tickets.export_invalid_snapshot"))?;
            document_bytes(&snapshot).map_err(access_error)?;
            authorize_work(&mut tx, &self.auth, &row, &snapshot).await?;
            lease.lock_current(&mut tx).await?;
            tx.commit().await?;
            Ok((row, snapshot))
        };
        let (row, snapshot) = job_budget(load).await?;
        let bytes = document_bytes(&snapshot).map_err(access_error)?;
        let artifact = tokio::task::spawn_blocking(move || artifact(bytes, permit))
            .await
            .map_err(|_| JobError::Transient("tickets.export_generation_failed"))??;
        let prepare = async {
            let mut tx = self.pool.begin().await?;
            authorize_work(&mut tx, &self.auth, &row, &snapshot).await?;
            lease.lock_current(&mut tx).await?;
            let attempt = self
                .files
                .prepare_generated(
                    &mut tx,
                    &row.requested_by,
                    &files::UploadInput {
                        file_name: format!("ticket-{}.json", payload.export_id),
                        content_type: "application/json".into(),
                        size: artifact.size,
                        sha256: artifact.sha256.clone(),
                    },
                    MAX_EXPORT_BYTES,
                    EXPORT_RETENTION_SECS,
                )
                .await
                .map_err(file_error)?;
            *candidate = Some(attempt.clone());
            tx.commit().await?;
            Ok(attempt)
        };
        let attempt = job_budget(prepare).await?;
        let verified = self
            .files
            .write_generated(&attempt, &artifact.path)
            .await
            .map_err(file_error)?;
        // region:export-publication
        let publish = async {
            let mut tx = self.pool.begin().await?;
            authorize_work(&mut tx, &self.auth, &row, &snapshot).await?;
            lease.lock_current(&mut tx).await?;
            let present: Option<String> = sqlx::query_scalar("SELECT id::text FROM support.exports WHERE id = $1::uuid AND job_id = $2::uuid AND file_id IS NULL AND snapshot IS NOT NULL AND expires_at > clock_timestamp() FOR UPDATE")
                .bind(&row.id).bind(&lease.id).fetch_optional(&mut *tx).await?;
            if present.is_none() {
                return Err(JobError::Permanent("tickets.export_expired"));
            }
            let file = match self
                .files
                .publish(&mut tx, &verified)
                .await
                .map_err(file_error)?
            {
                files::Publication::Adopted(file) => file,
                _ => return Err(JobError::Permanent("tickets.export_publication_conflict")),
            };
            sqlx::query("UPDATE support.exports SET file_id = $2::uuid, updated_at = now() WHERE id = $1::uuid")
                .bind(&row.id).bind(&file.id).execute(&mut *tx).await?;
            audit::append(
                &mut tx,
                audit::Event {
                    actor_id: &row.requested_by,
                    action: "tickets.export.complete",
                    resource_type: KIND,
                    resource_id: &row.id,
                    source: audit::Source::Job {
                        id: &lease.id,
                        correlation_id: &lease.correlation_id,
                    },
                    subject_user_id: None,
                },
            )
            .await?;
            lease.succeed(&mut tx).await?;
            tx.commit().await?;
            Ok(())
        };
        let result = job_budget(publish).await;
        // endregion:export-publication
        if artifact.directory.close().is_err() {
            tracing::warn!("ticket export temporary directory cleanup failed");
        }
        result
    }
}
// endregion:export-handler

pub fn export_handler(
    pool: PgPool,
    files: files::FileService,
    auth: AuthSettings,
) -> Arc<dyn Handler> {
    Arc::new(ExportHandler { pool, files, auth })
}

struct ExportExpiry {
    pool: PgPool,
}

#[async_trait::async_trait]
impl Maintenance for ExportExpiry {
    fn name(&self) -> &'static str {
        "tickets.export_expiry"
    }

    async fn schedule(&self) -> Result<(), JobError> {
        job_budget(async {
            let due: Vec<(String, String)> = sqlx::query_as("SELECT id::text, ticket_id::text FROM support.exports WHERE expires_at <= clock_timestamp() AND (snapshot IS NOT NULL OR file_id IS NOT NULL) ORDER BY expires_at, id LIMIT 25")
                .fetch_all(&self.pool).await?;
            for (export_id, ticket_id) in due {
                let mut tx = self.pool.begin().await?;
                sqlx::query("SELECT id FROM support.tickets WHERE id = $1::uuid FOR SHARE").bind(ticket_id).execute(&mut *tx).await?;
                let file: Option<Option<String>> = sqlx::query_scalar("SELECT file_id::text FROM support.exports WHERE id = $1::uuid AND expires_at <= clock_timestamp() AND (snapshot IS NOT NULL OR file_id IS NOT NULL) FOR UPDATE")
                    .bind(&export_id).fetch_optional(&mut *tx).await?;
                let Some(file) = file else { continue; };
                if let Some(file_id) = file {
                    files::mark_deleting(&mut tx, &file_id, &uuid::Uuid::now_v7().to_string()).await.map_err(file_error)?;
                }
                sqlx::query("UPDATE support.exports SET snapshot = NULL, file_id = NULL, updated_at = now() WHERE id = $1::uuid")
                    .bind(export_id).execute(&mut *tx).await?;
                tx.commit().await?;
            }
            Ok(())
        }).await
    }
}

pub fn export_maintenance(pool: PgPool) -> Arc<dyn Maintenance> {
    Arc::new(ExportExpiry { pool })
}
