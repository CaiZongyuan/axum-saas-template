use super::{Failure, Tickets, application};
use crate::{
    http::{ApiPath, BoundedJson, RequestId},
    modules::{
        audit,
        files::{
            self, CompletionPlan, DownloadCapability, FileInfo, FileService, Publication, Upload,
            UploadCapability, UploadInput,
        },
        idempotency, identity,
    },
};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use sqlx::{PgConnection, PgPool};
use std::time::Duration;
use utoipa::OpenApi;

const DATABASE_BUDGET: Duration = Duration::from_secs(3);
const MAX_ASSOCIATIONS: i64 = 50;

pub(super) fn routes() -> Router<Tickets> {
    Router::new()
        .route("/api/v1/tickets/{id}/uploads", post(start_upload))
        .route(
            "/api/v1/tickets/{id}/uploads/{upload_id}/complete",
            post(complete_upload),
        )
        .route("/api/v1/tickets/{id}/attachments", get(list_attachments))
        .route(
            "/api/v1/tickets/{id}/attachments/{file_id}/download",
            get(download_attachment),
        )
        .route(
            "/api/v1/tickets/{id}/attachments/{file_id}",
            delete(remove_attachment),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
}

#[derive(OpenApi)]
#[openapi(paths(
    start_upload,
    complete_upload,
    list_attachments,
    download_attachment,
    remove_attachment
))]
struct AttachmentApi;

pub(super) fn openapi() -> utoipa::openapi::OpenApi {
    AttachmentApi::openapi()
}

#[utoipa::path(post, path = "/api/v1/tickets/{id}/uploads", operation_id = "startTicketUpload", tag = "Tickets", request_body = UploadInput, params(("id" = String, Path), ("x-csrf-token" = String, Header), ("idempotency-key" = String, Header)), responses((status = 201, body = UploadCapability), (status = 400, body = crate::http::ApiErrorResponse), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 409, body = crate::http::ApiErrorResponse), (status = 410, body = crate::http::ApiErrorResponse), (status = 413, body = crate::http::ApiErrorResponse), (status = 422, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn start_upload(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiPath(ticket_id): ApiPath<String>,
    BoundedJson(mut input): BoundedJson<UploadInput>,
) -> Response {
    let actor = match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await
    {
        Ok(session) => session.user,
        Err(response) => return response,
    };
    let Some(files) = &state.files else {
        return files::Error::Unavailable.response(id);
    };
    let Ok(ticket_id) = uuid::Uuid::parse_str(&ticket_id) else {
        return Failure::NotFound.response(id);
    };
    if let Err(error) = files.validate(&mut input) {
        return error.response(id);
    }
    let Some(key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
    else {
        return Failure::InvalidKey.response(id);
    };
    let ticket_id = ticket_id.to_string();
    let upload = match tokio::time::timeout(
        DATABASE_BUDGET,
        register_upload(&state.pool, files, &actor.id, &ticket_id, key, &input),
    )
    .await
    {
        Ok(Ok(upload)) => upload,
        Ok(Err(error)) => return error.response(id),
        Err(_) => return Failure::Unavailable.response(id),
    };
    match tokio::time::timeout(DATABASE_BUDGET, files.upload_capability(&upload)).await {
        Ok(Ok(capability)) => (StatusCode::CREATED, Json(capability)).into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => files::Error::Unavailable.response(id),
    }
}

// region:upload-register
async fn register_upload(
    pool: &PgPool,
    files: &FileService,
    actor_id: &str,
    ticket_id: &str,
    key: &str,
    input: &UploadInput,
) -> Result<Upload, Failure> {
    let mut tx = pool.begin().await?;
    application::authorized(&mut tx, actor_id, ticket_id, true).await?;
    let fingerprint = idempotency::fingerprint(input)?;
    let scope = format!("POST /api/v1/tickets/{ticket_id}/uploads");
    let attempt = idempotency::Attempt {
        actor_id,
        scope: &scope,
        key,
        fingerprint: &fingerprint,
    };
    let upload = if let Some(saved) = idempotency::claim(&mut tx, &attempt).await? {
        let upload_id = saved["upload_id"].as_str().ok_or(Failure::Unavailable)?;
        association(&mut tx, ticket_id, upload_id).await?;
        files.load(&mut tx, upload_id).await?
    } else {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM support.uploads WHERE ticket_id = $1::uuid")
                .bind(ticket_id)
                .fetch_one(&mut *tx)
                .await?;
        if count >= MAX_ASSOCIATIONS {
            return Err(Failure::AttachmentLimit);
        }
        let upload = files.start(&mut tx, actor_id, input).await?;
        sqlx::query("INSERT INTO support.uploads (file_id, ticket_id) VALUES ($1::uuid, $2::uuid)")
            .bind(&upload.id)
            .bind(ticket_id)
            .execute(&mut *tx)
            .await?;
        idempotency::complete(
            &mut tx,
            &attempt,
            serde_json::json!({"upload_id":upload.id}),
        )
        .await?;
        upload
    };
    tx.commit().await?;
    Ok(upload)
}
// endregion:upload-register

async fn association(
    connection: &mut PgConnection,
    ticket_id: &str,
    file_id: &str,
) -> Result<bool, Failure> {
    sqlx::query_scalar(
        "SELECT published FROM support.uploads WHERE ticket_id = $1::uuid AND file_id = $2::uuid",
    )
    .bind(ticket_id)
    .bind(file_id)
    .fetch_optional(connection)
    .await?
    .ok_or(Failure::NotFound)
}

#[utoipa::path(post, path = "/api/v1/tickets/{id}/uploads/{upload_id}/complete", operation_id = "completeTicketUpload", tag = "Tickets", params(("id" = String, Path), ("upload_id" = String, Path), ("x-csrf-token" = String, Header)), responses((status = 200, body = FileInfo), (status = 400, body = crate::http::ApiErrorResponse), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 409, body = crate::http::ApiErrorResponse), (status = 410, body = crate::http::ApiErrorResponse), (status = 413, body = crate::http::ApiErrorResponse), (status = 422, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
// region:file-completion
async fn complete_upload(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiPath((ticket_id, upload_id)): ApiPath<(String, String)>,
) -> Response {
    let actor = match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await
    {
        Ok(session) => session.user,
        Err(response) => return response,
    };
    let Some(files) = &state.files else {
        return files::Error::Unavailable.response(id);
    };
    let (Ok(ticket_id), Ok(upload_id)) = (
        uuid::Uuid::parse_str(&ticket_id),
        uuid::Uuid::parse_str(&upload_id),
    ) else {
        return Failure::NotFound.response(id);
    };
    let (ticket_id, upload_id) = (ticket_id.to_string(), upload_id.to_string());
    let planning = async {
        let mut tx = state.pool.begin().await?;
        application::authorized(&mut tx, &actor.id, &ticket_id, true).await?;
        let published = association(&mut tx, &ticket_id, &upload_id).await?;
        let plan = files.plan_completion(&mut tx, &upload_id).await?;
        if matches!(plan, CompletionPlan::Ready(_)) && !published {
            return Err(Failure::NotFound);
        }
        tx.commit().await?;
        Ok::<_, Failure>(plan)
    };
    let plan = match tokio::time::timeout(DATABASE_BUDGET, planning).await {
        Ok(Ok(plan)) => plan,
        Ok(Err(error)) => return error.response(id),
        Err(_) => return Failure::Unavailable.response(id),
    };
    let attempt = match plan {
        CompletionPlan::Ready(file) => return Json(file).into_response(),
        CompletionPlan::Expired => return files::Error::Expired.response(id),
        CompletionPlan::Rejected => return files::Error::Rejected.response(id),
        CompletionPlan::Attempt(attempt) => attempt,
    };
    let verified = match files.verify_candidate(&attempt).await {
        Ok(verified) => verified,
        Err(error) => {
            abandon(
                &state.pool,
                files,
                &attempt,
                matches!(error, files::Error::Rejected | files::Error::TooLarge),
            )
            .await;
            return error.response(id);
        }
    };
    let fresh = match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await
    {
        Ok(session) => session.user,
        Err(response) => {
            abandon(&state.pool, files, &attempt, false).await;
            return response;
        }
    };
    let publication = async {
        let mut tx = state.pool.begin().await?;
        application::authorized(&mut tx, &fresh.id, &ticket_id, true).await?;
        if identity::background_credential(&mut tx, &state.auth, &headers, &fresh.id)
            .await?
            .is_none()
        {
            return Err(Failure::Unauthorized);
        }
        let published = association(&mut tx, &ticket_id, &upload_id).await?;
        let result = match files.publish(&mut tx, &verified).await? {
            Publication::Adopted(file) => {
                sqlx::query("UPDATE support.uploads SET published = true WHERE ticket_id = $1::uuid AND file_id = $2::uuid")
                    .bind(&ticket_id).bind(&file.id).execute(&mut *tx).await?;
                audit::append(
                    &mut tx,
                    audit::Event {
                        actor_id: &fresh.id,
                        action: "tickets.attachment.publish",
                        resource_type: "tickets.attachment",
                        resource_id: &file.id,
                        source: audit::Source::Request(&id.0),
                        subject_user_id: None,
                    },
                )
                .await?;
                Some(file)
            }
            Publication::Existing(file) if published => Some(file),
            Publication::Existing(_) => return Err(Failure::NotFound),
            Publication::Expired => None,
        };
        tx.commit().await?;
        Ok::<_, Failure>(result)
    };
    match tokio::time::timeout(DATABASE_BUDGET, publication).await {
        Ok(Ok(Some(file))) => Json(file).into_response(),
        result => {
            abandon(&state.pool, files, &attempt, false).await;
            match result {
                Ok(Ok(None)) => files::Error::Expired.response(id),
                Ok(Err(error)) => error.response(id),
                _ => Failure::Unavailable.response(id),
            }
        }
    }
}
// endregion:file-completion

async fn abandon(
    pool: &PgPool,
    files: &FileService,
    attempt: &files::CompletionAttempt,
    rejected: bool,
) {
    // A failed cleanup update still leaves the committed candidate for maintenance.
    let _ = tokio::time::timeout(DATABASE_BUDGET, async {
        let mut tx = pool.begin().await?;
        files.abandon(&mut tx, attempt, rejected).await?;
        tx.commit().await?;
        Ok::<_, files::Error>(())
    })
    .await;
}

#[utoipa::path(get, path = "/api/v1/tickets/{id}/attachments", operation_id = "listTicketAttachments", tag = "Tickets", params(("id" = String, Path)), responses((status = 200, body = [FileInfo]), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn list_attachments(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiPath(ticket_id): ApiPath<String>,
) -> Response {
    let actor =
        match identity::require_session(&state.pool, &state.auth, &headers, &id, false).await {
            Ok(session) => session.user,
            Err(response) => return response,
        };
    let Ok(ticket_id) = uuid::Uuid::parse_str(&ticket_id) else {
        return Failure::NotFound.response(id);
    };
    let list = async {
        let mut tx = state.pool.begin().await?;
        application::authorized(&mut tx, &actor.id, &ticket_id.to_string(), false).await?;
        let ids: Vec<String> = sqlx::query_scalar("SELECT file_id::text FROM support.uploads WHERE ticket_id = $1::uuid AND published ORDER BY file_id LIMIT $2")
            .bind(ticket_id.to_string()).bind(MAX_ASSOCIATIONS).fetch_all(&mut *tx).await?;
        let data = files::ready_info(&mut tx, &ids).await?;
        tx.commit().await?;
        Ok::<_, Failure>(data)
    };
    match tokio::time::timeout(DATABASE_BUDGET, list).await {
        Ok(Ok(data)) => Json(data).into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Failure::Unavailable.response(id),
    }
}

#[utoipa::path(get, path = "/api/v1/tickets/{id}/attachments/{file_id}/download", operation_id = "downloadTicketAttachment", tag = "Tickets", params(("id" = String, Path), ("file_id" = String, Path)), responses((status = 200, body = DownloadCapability), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn download_attachment(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiPath((ticket_id, file_id)): ApiPath<(String, String)>,
) -> Response {
    let actor =
        match identity::require_session(&state.pool, &state.auth, &headers, &id, false).await {
            Ok(session) => session.user,
            Err(response) => return response,
        };
    let Some(files) = &state.files else {
        return files::Error::Unavailable.response(id);
    };
    let (Ok(ticket_id), Ok(file_id)) = (
        uuid::Uuid::parse_str(&ticket_id),
        uuid::Uuid::parse_str(&file_id),
    ) else {
        return Failure::NotFound.response(id);
    };
    let (ticket_id, file_id) = (ticket_id.to_string(), file_id.to_string());
    let download = async {
        let mut tx = state.pool.begin().await?;
        application::authorized(&mut tx, &actor.id, &ticket_id, false).await?;
        if !association(&mut tx, &ticket_id, &file_id).await? {
            return Err(Failure::NotFound);
        }
        let capability = files.download(&mut tx, &file_id, false).await?;
        tx.commit().await?;
        Ok::<_, Failure>(capability)
    };
    match tokio::time::timeout(DATABASE_BUDGET, download).await {
        Ok(Ok(capability)) => Json(capability).into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Failure::Unavailable.response(id),
    }
}

#[utoipa::path(delete, path = "/api/v1/tickets/{id}/attachments/{file_id}", operation_id = "deleteTicketAttachment", tag = "Tickets", params(("id" = String, Path), ("file_id" = String, Path), ("x-csrf-token" = String, Header)), responses((status = 204), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn remove_attachment(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiPath((ticket_id, file_id)): ApiPath<(String, String)>,
) -> Response {
    let actor = match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await
    {
        Ok(session) => session.user,
        Err(response) => return response,
    };
    let (Ok(ticket_id), Ok(file_id)) = (
        uuid::Uuid::parse_str(&ticket_id),
        uuid::Uuid::parse_str(&file_id),
    ) else {
        return Failure::NotFound.response(id);
    };
    let (ticket_id, file_id) = (ticket_id.to_string(), file_id.to_string());
    let remove = async {
        let mut tx = state.pool.begin().await?;
        application::authorized(&mut tx, &actor.id, &ticket_id, true).await?;
        let removed = sqlx::query(
            "DELETE FROM support.uploads WHERE ticket_id = $1::uuid AND file_id = $2::uuid",
        )
        .bind(&ticket_id)
        .bind(&file_id)
        .execute(&mut *tx)
        .await?;
        if removed.rows_affected() != 1 {
            return Err(Failure::NotFound);
        }
        files::mark_deleting(&mut tx, &file_id, &id.0).await?;
        audit::append(
            &mut tx,
            audit::Event {
                actor_id: &actor.id,
                action: "tickets.attachment.delete",
                resource_type: "tickets.attachment",
                resource_id: &file_id,
                source: audit::Source::Request(&id.0),
                subject_user_id: None,
            },
        )
        .await?;
        tx.commit().await?;
        Ok::<_, Failure>(())
    };
    match tokio::time::timeout(DATABASE_BUDGET, remove).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Failure::Unavailable.response(id),
    }
}
