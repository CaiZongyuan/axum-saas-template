use axum::{
    Extension, Json,
    extract::{MatchedPath, Request},
    http::{HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use std::collections::BTreeMap;
use tracing::Instrument;
use utoipa::ToSchema;

#[derive(Clone)]
pub struct RequestId(pub String);

#[derive(Serialize, ToSchema)]
pub struct ApiErrorResponse {
    error: ApiError,
}

#[derive(Serialize, ToSchema)]
pub struct ApiError {
    code: &'static str,
    message: &'static str,
    request_id: String,
    details: BTreeMap<String, String>,
}

pub async fn request_context(mut request: Request, next: Next) -> Response {
    let id = uuid::Uuid::now_v7().to_string();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map_or("unmatched", |path| path.as_str());
    let span =
        tracing::info_span!("http.request", request_id = %id, method = %request.method(), route);
    request.extensions_mut().insert(RequestId(id.clone()));
    let mut response = async move {
        let response = next.run(request).await;
        tracing::info!(status = response.status().as_u16(), "request completed");
        response
    }
    .instrument(span)
    .await;
    response.headers_mut().insert(
        "x-request-id",
        HeaderValue::from_str(&id).expect("UUID is a valid header"),
    );
    response
}

pub async fn not_found(Extension(id): Extension<RequestId>) -> Response {
    public_error(
        StatusCode::NOT_FOUND,
        "http.not_found",
        "Resource not found",
        id,
    )
}

pub async fn method_not_allowed(Extension(id): Extension<RequestId>) -> Response {
    public_error(
        StatusCode::METHOD_NOT_ALLOWED,
        "http.method_not_allowed",
        "Method not allowed",
        id,
    )
}

pub fn public_error(
    status: StatusCode,
    code: &'static str,
    message: &'static str,
    id: RequestId,
) -> Response {
    (
        status,
        Json(ApiErrorResponse {
            error: ApiError {
                code,
                message,
                request_id: id.0,
                details: BTreeMap::new(),
            },
        }),
    )
        .into_response()
}
