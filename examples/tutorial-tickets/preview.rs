// region:preview
use axum::{Json, Router, routing::get};
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

#[derive(Serialize, ToSchema)]
struct TicketPreview {
    title: &'static str,
    status: &'static str,
}

#[utoipa::path(
    get,
    path = "/api/v1/tickets/preview",
    operation_id = "previewTicket",
    tag = "Tickets",
    responses((status = 200, body = TicketPreview))
)]
async fn preview() -> Json<TicketPreview> {
    Json(TicketPreview {
        title: "First ticket",
        status: "open",
    })
}

#[derive(OpenApi)]
#[openapi(paths(preview))]
struct TicketApi;

pub fn router() -> Router {
    Router::new().route("/api/v1/tickets/preview", get(preview))
}

pub fn openapi() -> utoipa::openapi::OpenApi {
    TicketApi::openapi()
}
// endregion:preview
