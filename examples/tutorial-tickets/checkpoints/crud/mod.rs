mod application;
mod domain;

use crate::{
    http::{ApiPath, ApiQuery, BoundedJson, RequestId, public_error},
    modules::identity,
};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use saas_platform::config::AuthSettings;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{OpenApi, ToSchema};

#[derive(Clone)]
struct Tickets {
    pool: PgPool,
    auth: AuthSettings,
    _files: Option<crate::modules::files::FileService>,
}

// region:ticket-protocol
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateTicket {
    title: String,
    description: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateTicket {
    title: String,
    description: String,
    status: String,
    version: i64,
}

#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct TicketQuery {
    #[param(minimum = 1, maximum = 100, default = 50)]
    limit: Option<u32>,
}

#[derive(Serialize, Deserialize, ToSchema, sqlx::FromRow)]
pub struct Ticket {
    pub id: String,
    pub created_by: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub version: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

// endregion:ticket-protocol
enum Failure {
    InvalidInput,
    InvalidKey,
    KeyConflict,
    VersionConflict,
    InvalidVersion,
    InvalidState,
    Forbidden,
    NotFound,
    Unavailable,
}

impl From<sqlx::Error> for Failure {
    fn from(_: sqlx::Error) -> Self {
        Self::Unavailable
    }
}

impl From<crate::modules::idempotency::Error> for Failure {
    fn from(error: crate::modules::idempotency::Error) -> Self {
        use crate::modules::idempotency::Error;
        match error {
            Error::InvalidKey => Self::InvalidKey,
            Error::Conflict => Self::KeyConflict,
            Error::Unavailable => Self::Unavailable,
        }
    }
}

impl Failure {
    fn response(self, id: RequestId) -> Response {
        let (status, code, message) = match self {
            Self::VersionConflict => (
                StatusCode::CONFLICT,
                "tickets.version_conflict",
                "Read the current ticket before retrying your update",
            ),
            Self::InvalidVersion => (
                StatusCode::BAD_REQUEST,
                "tickets.invalid_version",
                "Use a positive expected version",
            ),
            Self::InvalidState => (
                StatusCode::BAD_REQUEST,
                "tickets.invalid_state",
                "Use open or closed status",
            ),
            Self::InvalidKey => (
                StatusCode::BAD_REQUEST,
                "tickets.invalid_key",
                "Provide an Idempotency-Key of 1-128 visible ASCII bytes",
            ),
            Self::KeyConflict => (
                StatusCode::CONFLICT,
                "tickets.key_conflict",
                "The key was used with different input",
            ),
            Self::InvalidInput => (
                StatusCode::BAD_REQUEST,
                "tickets.invalid_input",
                "Use a title of 1-200 characters and a description up to 8192 bytes without NUL",
            ),
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                "tickets.forbidden",
                "The operation is not allowed",
            ),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "tickets.not_found",
                "Ticket not found",
            ),
            Self::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "tickets.unavailable",
                "Ticket service is unavailable",
            ),
        };
        public_error(status, code, message, id)
    }
}

// region:routes
pub fn router(
    pool: PgPool,
    auth: AuthSettings,
    files: Option<crate::modules::files::FileService>,
) -> Router {
    Router::new()
        .route("/api/v1/tickets", post(create_ticket).get(list_tickets))
        .route(
            "/api/v1/tickets/{id}",
            get(read_ticket).put(update_ticket).delete(delete_ticket),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
        .with_state(Tickets {
            pool,
            auth,
            _files: files,
        })
}

// endregion:routes
#[derive(OpenApi)]
#[openapi(paths(create_ticket, read_ticket, update_ticket, list_tickets, delete_ticket))]
struct TicketApi;

pub fn openapi() -> utoipa::openapi::OpenApi {
    TicketApi::openapi()
}

#[utoipa::path(post, path = "/api/v1/tickets", operation_id = "createTicket", tag = "Tickets", request_body = CreateTicket, params(("x-csrf-token" = String, Header), ("idempotency-key" = String, Header)), responses((status = 201, body = Ticket), (status = 400, body = crate::http::ApiErrorResponse), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 408, body = crate::http::ApiErrorResponse), (status = 409, body = crate::http::ApiErrorResponse), (status = 413, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
// region:create-handler
async fn create_ticket(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    BoundedJson(input): BoundedJson<CreateTicket>,
) -> Response {
    let actor = match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await
    {
        Ok(session) => session.user,
        Err(response) => return response,
    };
    let Some(content) = domain::Content::new(input.title, input.description) else {
        return Failure::InvalidInput.response(id);
    };
    let Some(key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
    else {
        return Failure::InvalidKey.response(id);
    };
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        application::create(&state.pool, &actor.id, content, key, &id.0),
    )
    .await
    {
        Ok(Ok(ticket)) => (StatusCode::CREATED, Json(ticket)).into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Failure::Unavailable.response(id),
    }
}

// endregion:create-handler
#[utoipa::path(get, path = "/api/v1/tickets/{id}", operation_id = "readTicket", tag = "Tickets", params(("id" = String, Path)), responses((status = 200, body = Ticket), (status = 400, body = crate::http::ApiErrorResponse), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn read_ticket(
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
    if uuid::Uuid::parse_str(&ticket_id).is_err() {
        return Failure::NotFound.response(id);
    }
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        application::read(&state.pool, &actor.id, &ticket_id),
    )
    .await
    {
        Ok(Ok(ticket)) => Json(ticket).into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Failure::Unavailable.response(id),
    }
}

#[utoipa::path(put, path = "/api/v1/tickets/{id}", operation_id = "updateTicket", tag = "Tickets", request_body = UpdateTicket, params(("id" = String, Path), ("x-csrf-token" = String, Header)), responses((status = 200, body = Ticket), (status = 400, body = crate::http::ApiErrorResponse), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 408, body = crate::http::ApiErrorResponse), (status = 409, body = crate::http::ApiErrorResponse), (status = 413, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn update_ticket(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiPath(ticket_id): ApiPath<String>,
    BoundedJson(input): BoundedJson<UpdateTicket>,
) -> Response {
    let actor = match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await
    {
        Ok(session) => session.user,
        Err(response) => return response,
    };
    if uuid::Uuid::parse_str(&ticket_id).is_err() {
        return Failure::NotFound.response(id);
    }
    if input.version <= 0 {
        return Failure::InvalidVersion.response(id);
    }
    if !matches!(input.status.as_str(), "open" | "closed") {
        return Failure::InvalidState.response(id);
    }
    let Some(content) = domain::Content::new(input.title, input.description) else {
        return Failure::InvalidInput.response(id);
    };
    let change = application::Change {
        content,
        status: input.status,
        version: input.version,
    };
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        application::update(&state.pool, &actor.id, &ticket_id, change, &id.0),
    )
    .await
    {
        Ok(Ok(ticket)) => Json(ticket).into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Failure::Unavailable.response(id),
    }
}

#[utoipa::path(get, path = "/api/v1/tickets", operation_id = "listTickets", tag = "Tickets", params(TicketQuery), responses((status = 200, body = [Ticket]), (status = 400, body = crate::http::ApiErrorResponse), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn list_tickets(
    State(state): State<Tickets>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiQuery(query): ApiQuery<TicketQuery>,
) -> Response {
    let actor =
        match identity::require_session(&state.pool, &state.auth, &headers, &id, false).await {
            Ok(session) => session.user,
            Err(response) => return response,
        };
    let limit = query.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Failure::InvalidInput.response(id);
    }
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        application::list(&state.pool, &actor.id, limit),
    )
    .await
    {
        Ok(Ok(tickets)) => Json(tickets).into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Failure::Unavailable.response(id),
    }
}

#[utoipa::path(delete, path = "/api/v1/tickets/{id}", operation_id = "deleteTicket", tag = "Tickets", params(("id" = String, Path), ("x-csrf-token" = String, Header)), responses((status = 204), (status = 400, body = crate::http::ApiErrorResponse), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 404, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn delete_ticket(
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
    if uuid::Uuid::parse_str(&ticket_id).is_err() {
        return Failure::NotFound.response(id);
    }
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        application::remove(&state.pool, &actor.id, &ticket_id, &id.0),
    )
    .await
    {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Failure::Unavailable.response(id),
    }
}
