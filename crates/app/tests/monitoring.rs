use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

async fn body(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
async fn register(app: &Router, email: &str) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/auth/register")
                .header("origin", "http://127.0.0.1:15400")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"email":email,"password":"monitoring-test-password"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .into()
}
async fn get(app: &Router, cookie: &str, path: &str) -> Response {
    app.clone()
        .oneshot(
            Request::get(path)
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
async fn administrators_see_real_queue_when_telemetry_is_disabled_members_are_denied(pool: PgPool) {
    let app = saas_app::router(pool.clone());
    let owner = register(&app, "monitor-owner@example.test").await;
    let member = register(&app, "monitor-member@example.test").await;
    let mut tx = pool.begin().await.unwrap();
    saas_app::modules::jobs::enqueue(
        &mut tx,
        saas_app::modules::jobs::NewJob {
            kind: "test.monitoring",
            schema_version: 1,
            max_attempts: 2,
            payload: json!({}),
            correlation_id: "monitoring-test",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let response = get(&app, &owner, "/api/v1/system/monitoring?window_minutes=15").await;
    assert_eq!(response.status(), StatusCode::OK);
    let snapshot = body(response).await;
    assert_eq!(snapshot["collection"]["state"], "disabled");
    assert!(snapshot["http"].is_null());
    assert_eq!(snapshot["jobs"]["waiting"], 1);
    assert_eq!(snapshot["jobs"]["running"], 0);
    assert!(snapshot["jobs"]["oldest_wait_seconds"].as_f64().unwrap() >= 0.0);
    assert_eq!(snapshot["services"]["worker"], "unconfigured");
    assert_eq!(
        get(&app, &member, "/api/v1/system/monitoring")
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        get(&app, "", "/api/v1/system/monitoring").await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get(&app, &owner, "/api/v1/system/monitoring?window_minutes=300")
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn fresh_collector_samples_supply_real_http_summary_and_history(pool: PgPool) {
    use axum::{Json, routing::get as route_get};
    let now = chrono::Utc::now().timestamp();
    let upstream = Router::new()
        .route("/api/v1/query", route_get(move || async move {
            let result: Vec<_> = [("heartbeat", now as f64), ("requests", 200.0), ("errors", 2.0), ("p50", 0.08), ("p95", 0.45)].into_iter()
                .map(|(kind,value)| json!({"metric":{"monitoring_metric":kind},"value":[now,value.to_string()]})).collect();
            Json(json!({"status":"success","data":{"resultType":"vector","result":result}}))
        }))
        .route("/api/v1/query_range", route_get(move |axum::extract::Query(parameters): axum::extract::Query<std::collections::HashMap<String, String>>| async move {
            let now = parameters["end"].parse::<i64>().unwrap();
            let result: Vec<_> = [("requests", 2.0), ("errors", 2.0), ("p95", 0.75)].into_iter()
                .map(|(kind,value)| json!({"metric":{"monitoring_metric":kind},"values":[[now - 60,value.to_string()],[now,value.to_string()]]})).collect();
            Json(json!({"status":"success","data":{"resultType":"matrix","result":result}}))
        }))
        .route("/health/ready", route_get(|| async { StatusCode::OK }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let monitoring = saas_app::modules::system::monitoring::Monitoring::new(
        saas_platform::monitoring::MonitoringSettings {
            prometheus_url: Some(url.clone()),
            worker_url: Some(url),
            grafana_url: None,
        },
    )
    .unwrap();
    let app = saas_app::compose_routes_with_options(
        pool,
        Default::default(),
        Router::new(),
        saas_app::openapi(),
        saas_app::CoreOptions {
            monitoring: monitoring.clone(),
            ..Default::default()
        },
    );
    let owner = register(&app, "monitor-samples@example.test").await;
    let response = get(&app, &owner, "/api/v1/system/monitoring?window_minutes=60").await;
    assert_eq!(response.status(), StatusCode::OK);
    let snapshot = body(response).await;
    assert_eq!(snapshot["collection"]["state"], "collecting");
    assert_eq!(snapshot["services"]["worker"], "ready");
    assert_eq!(snapshot["http"]["requests"], 200.0);
    assert_eq!(snapshot["http"]["error_rate_percent"], 1.0);
    assert_eq!(snapshot["http"]["p50_ms"], 80.0);
    assert_eq!(snapshot["http"]["p95_ms"], 450.0);
    let points = snapshot["http"]["series"].as_array().unwrap();
    assert_eq!(
        points.len(),
        61,
        "missing historical samples must leave explicit chart gaps"
    );
    assert!(points[0]["requests_per_second"].is_null());
    assert_eq!(points.last().unwrap()["requests_per_second"], 2.0);
    assert_eq!(points.last().unwrap()["error_rate_percent"], 2.0);
    assert_eq!(points.last().unwrap()["p95_ms"], 750.0);
    let sample = monitoring.error_sample().await.unwrap();
    assert_eq!(sample.requests, 200.0);
    assert_eq!(sample.errors, 2.0);
    server.abort();
}

#[sqlx::test(migrations = "../../migrations")]
async fn no_requests_are_distinct_from_missing_stale_and_unavailable_collection(pool: PgPool) {
    use axum::{Json, response::IntoResponse, routing::get as route_get};
    use std::sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    };
    let mode = Arc::new(AtomicU8::new(0));
    let current = mode.clone();
    let upstream = Router::new()
        .route("/api/v1/query", route_get(move || {
            let current = current.clone();
            async move {
                let mode = current.load(Ordering::SeqCst);
                if mode == 3 { return StatusCode::SERVICE_UNAVAILABLE.into_response() }
                if mode == 4 { return "x".repeat(300_000).into_response() }
                if mode == 5 { return std::future::pending::<Response>().await }
                let now = chrono::Utc::now().timestamp();
                let result = if mode == 1 { vec![] } else { vec![
                    json!({"metric":{"monitoring_metric":"heartbeat"},"value":[now,(if mode == 2 { now - 3600 } else { now }).to_string()]}),
                    json!({"metric":{"monitoring_metric":"requests"},"value":[now,if mode == 6 { "NaN" } else { "0" }]}),
                    json!({"metric":{"monitoring_metric":"p95"},"value":[now,"NaN"]}),
                ] };
                Json(json!({"status":"success","data":{"resultType":"vector","result":result}})).into_response()
            }
        }))
        .route("/api/v1/query_range", route_get(|| async { Json(json!({"status":"success","data":{"resultType":"matrix","result":[]}})) }))
        .route("/health/ready", route_get(|| async { StatusCode::SERVICE_UNAVAILABLE }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let monitoring = saas_app::modules::system::monitoring::Monitoring::new(
        saas_platform::monitoring::MonitoringSettings {
            prometheus_url: Some(url.clone()),
            worker_url: Some(url),
            grafana_url: None,
        },
    )
    .unwrap();
    let app = saas_app::compose_routes_with_options(
        pool,
        Default::default(),
        Router::new(),
        saas_app::openapi(),
        saas_app::CoreOptions {
            monitoring: monitoring.clone(),
            ..Default::default()
        },
    );
    let owner = register(&app, "monitor-states@example.test").await;
    let zero = body(get(&app, &owner, "/api/v1/system/monitoring").await).await;
    assert_eq!(zero["collection"]["state"], "collecting");
    assert_eq!(zero["http"]["requests"], 0.0);
    assert!(zero["http"]["error_rate_percent"].is_null());
    assert!(zero["http"]["p95_ms"].is_null());
    assert_eq!(zero["services"]["worker"], "unavailable");
    for (value, expected) in [
        (1, "waiting"),
        (2, "stale"),
        (3, "unavailable"),
        (4, "unavailable"),
        (5, "unavailable"),
        (6, "unavailable"),
    ] {
        mode.store(value, Ordering::SeqCst);
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            get(&app, &owner, "/api/v1/system/monitoring"),
        )
        .await
        .expect("external monitoring outages have a bounded budget");
        assert_eq!(response.status(), StatusCode::OK);
        let snapshot = body(response).await;
        assert_eq!(
            snapshot["collection"]["state"], expected,
            "external mode {value}"
        );
        assert!(snapshot["http"].is_null());
        assert_eq!(snapshot["jobs"]["waiting"], 0);
        assert!(
            monitoring.error_sample().await.is_none(),
            "missing samples cannot resolve alerts"
        );
    }
    assert_eq!(get(&app, "", "/health/live").await.status(), StatusCode::OK);
    server.abort();
}

#[sqlx::test(migrations = "../../migrations")]
async fn revoking_an_administrator_while_collection_is_pending_blocks_the_response(pool: PgPool) {
    use axum::{Json, routing::get as route_get};
    use std::sync::Arc;
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let received = entered.clone();
    let released = release.clone();
    let upstream = Router::new()
        .route(
            "/api/v1/query",
            route_get(move || {
                let entered = received.clone();
                let release = released.clone();
                async move {
                    entered.notify_one();
                    release.notified().await;
                    Json(json!({"status":"success","data":{"resultType":"vector","result":[]}}))
                }
            }),
        )
        .route(
            "/api/v1/query_range",
            route_get(|| async {
                Json(json!({"status":"success","data":{"resultType":"matrix","result":[]}}))
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let monitoring = saas_app::modules::system::monitoring::Monitoring::new(
        saas_platform::monitoring::MonitoringSettings {
            prometheus_url: Some(url),
            ..Default::default()
        },
    )
    .unwrap();
    let app = saas_app::compose_routes_with_options(
        pool,
        Default::default(),
        Router::new(),
        saas_app::openapi(),
        saas_app::CoreOptions {
            monitoring,
            ..Default::default()
        },
    );
    let owner = register(&app, "monitor-revoke-owner@example.test").await;
    let administrator = register(&app, "monitor-revoke-admin@example.test").await;
    let owner_session = body(get(&app, &owner, "/api/v1/auth/session").await).await;
    let target_session = body(get(&app, &administrator, "/api/v1/auth/session").await).await;
    let target = target_session["user"]["id"].as_str().unwrap();
    let change_role = |version, role| {
        app.clone().oneshot(
            Request::put(format!("/api/v1/organization/members/{target}"))
                .header("origin", "http://127.0.0.1:15400")
                .header("cookie", &owner)
                .header("content-type", "application/json")
                .header(
                    "x-csrf-token",
                    owner_session["csrf_token"].as_str().unwrap(),
                )
                .body(Body::from(
                    json!({"role":role,"active":true,"version":version}).to_string(),
                ))
                .unwrap(),
        )
    };
    assert_eq!(
        change_role(1, "admin").await.unwrap().status(),
        StatusCode::OK
    );
    let viewing = app.clone();
    let request =
        tokio::spawn(
            async move { get(&viewing, &administrator, "/api/v1/system/monitoring").await },
        );
    tokio::time::timeout(std::time::Duration::from_secs(2), entered.notified())
        .await
        .unwrap();
    assert_eq!(
        change_role(2, "member").await.unwrap().status(),
        StatusCode::OK
    );
    release.notify_one();
    assert_eq!(request.await.unwrap().status(), StatusCode::FORBIDDEN);
    server.abort();
}
