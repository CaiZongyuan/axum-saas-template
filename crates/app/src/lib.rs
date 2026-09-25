pub mod http;
pub mod modules;

use axum::{
    Extension, Json, Router, extract::State, http::StatusCode, middleware, response::Response,
    routing::get,
};
use serde::Serialize;
use sqlx::PgPool;
use utoipa::{OpenApi, ToSchema};

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    status: &'static str,
}

#[utoipa::path(get, path = "/health/live", operation_id = "getLiveness", tag = "System", responses((status = 200, body = HealthResponse, description = "Process is alive")))]
async fn live() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[utoipa::path(get, path = "/health/ready", operation_id = "getReadiness", tag = "System", responses((status = 200, body = HealthResponse, description = "Database migrations are available"), (status = 503, body = http::ApiErrorResponse, description = "Database is not ready")))]
async fn ready(
    State(pool): State<PgPool>,
    Extension(id): Extension<http::RequestId>,
) -> Result<Json<HealthResponse>, Response> {
    modules::system::schema_version(&pool)
        .await
        .ok_or_else(|| {
            http::public_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "database.unavailable",
                "Database is not ready",
                id,
            )
        })?;
    Ok(Json(HealthResponse { status: "ok" }))
}

pub fn router(pool: PgPool) -> Router {
    router_with_auth(pool, saas_platform::config::AuthSettings::default())
}

pub fn router_with_auth(pool: PgPool, auth: saas_platform::config::AuthSettings) -> Router {
    Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/api/v1/system/status", get(modules::system::status))
        .route("/api/openapi.json", get(|| async { Json(openapi()) }))
        .with_state(pool.clone())
        .merge(modules::identity::router(pool, auth))
        .fallback(http::not_found)
        .method_not_allowed_fallback(http::method_not_allowed)
        .layer(middleware::from_fn(http::request_context))
}

#[derive(OpenApi)]
#[openapi(
    info(title = "SaaS Template API", version = "0.1.0"),
    paths(
        live,
        ready,
        modules::system::status,
        modules::identity::register,
        modules::identity::login,
        modules::identity::logout,
        modules::identity::current_session
    ),
    components(schemas(
        HealthResponse,
        http::ApiErrorResponse,
        http::ApiError,
        modules::system::SystemStatus
    ))
)]
struct ApiDoc;

pub fn openapi() -> utoipa::openapi::OpenApi {
    ApiDoc::openapi()
}
