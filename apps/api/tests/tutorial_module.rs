#[path = "../../../examples/tutorial-tickets/preview.rs"]
mod tickets;

use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn a_tutorial_module_composes_with_core_and_publishes_its_contract() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
        .unwrap();
    let mut contract = saas_app::openapi();
    contract.merge(tickets::openapi());
    let app = saas_app::compose_routes(
        pool,
        saas_platform::config::AuthSettings::default(),
        tickets::router(),
        contract,
    );
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/tickets/preview")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert!(response.headers().contains_key("x-request-id"));
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"title":"First ticket","status":"open"})
    );
    let response = app
        .oneshot(
            Request::get("/api/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        json["paths"]["/api/v1/tickets/preview"]["get"]["operationId"],
        "previewTicket"
    );
    assert!(json["components"]["schemas"]["TicketPreview"].is_object());
}
