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

struct Browser {
    id: String,
    cookie: String,
    csrf: String,
}
async fn data(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
async fn register(app: &Router, email: &str) -> Browser {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/auth/register")
                .header("origin", "http://127.0.0.1:15400")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"email": email, "password":"a-long-test-password"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let body = data(response).await;
    Browser {
        id: body["user"]["id"].as_str().unwrap().into(),
        cookie,
        csrf: body["csrf_token"].as_str().unwrap().into(),
    }
}
async fn request(app: &Router, actor: &Browser, method: &str, path: &str, body: Value) -> Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("origin", "http://127.0.0.1:15400")
                .header("content-type", "application/json")
                .header("cookie", &actor.cookie)
                .header("x-csrf-token", &actor.csrf)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
const RULE: &str = "/api/v1/system/monitoring/alerts";

#[sqlx::test(migrations = "../../migrations")]
async fn only_a_current_administrator_can_read_the_disabled_initial_alert_rule(pool: PgPool) {
    let app = saas_app::router(pool);
    let owner = register(&app, "monitor-owner@example.test").await;
    let member = register(&app, "monitor-member@example.test").await;
    let response = request(&app, &owner, "GET", RULE, json!(null)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let rule = data(response).await;
    assert_eq!(rule["enabled"], false);
    assert_eq!(rule["state"], "disabled");
    assert_eq!(rule["error_rate_percent"], 1.0);
    assert_eq!(rule["duration_minutes"], 5);
    assert_eq!(
        request(&app, &member, "GET", RULE, json!(null))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.oneshot(Request::get(RULE).body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn rule_updates_are_persistent_audited_and_reject_stale_versions(pool: PgPool) {
    let app = saas_app::router(pool.clone());
    let owner = register(&app, "rule-edit-owner@example.test").await;
    let original = data(request(&app, &owner, "GET", RULE, json!(null)).await).await;
    let change = json!({"version":original["version"],"enabled":true,"error_rate_percent":2.5,"duration_minutes":1});
    let response = request(&app, &owner, "PUT", RULE, change.clone()).await;
    assert_eq!(response.status(), StatusCode::OK);
    let updated = data(response).await;
    assert_eq!(updated["version"], 2);
    assert_eq!(updated["state"], "no_data");
    let remounted = saas_app::router(pool);
    let rule = data(request(&remounted, &owner, "GET", RULE, json!(null)).await).await;
    assert_eq!(rule["error_rate_percent"], 2.5);
    assert_eq!(rule["duration_minutes"], 1);
    assert_eq!(
        request(&remounted, &owner, "PUT", RULE, change)
            .await
            .status(),
        StatusCode::CONFLICT
    );
    let audit = data(
        request(
            &remounted,
            &owner,
            "GET",
            "/api/v1/audit-events?action=monitoring.alert_rule.updated",
            json!(null),
        )
        .await,
    )
    .await;
    assert_eq!(audit["data"].as_array().unwrap().len(), 1);
    assert_eq!(audit["data"][0]["actor_id"], owner.id);
}

#[sqlx::test(migrations = "../../migrations")]
async fn a_test_notice_is_private_to_its_requesting_administrator(pool: PgPool) {
    let app = saas_app::router(pool);
    let owner = register(&app, "test-alert-owner@example.test").await;
    let member = register(&app, "test-alert-member@example.test").await;
    let path = format!("{RULE}/test");
    assert_eq!(
        request(&app, &owner, "POST", &path, json!({}))
            .await
            .status(),
        StatusCode::CREATED
    );
    let inbox =
        data(request(&app, &owner, "GET", "/api/v1/notifications", json!(null)).await).await;
    assert_eq!(inbox["unread_count"], 1);
    assert_eq!(inbox["data"][0]["outcome"], "test");
    assert_eq!(inbox["data"][0]["target"]["kind"], "core.monitoring.alert");
    let other_inbox =
        data(request(&app, &member, "GET", "/api/v1/notifications", json!(null)).await).await;
    assert_eq!(other_inbox["unread_count"], 0);
    assert_eq!(
        request(&app, &member, "POST", &path, json!({}))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let without_csrf = app
        .oneshot(
            Request::post(path)
                .header("origin", "http://127.0.0.1:15400")
                .header("content-type", "application/json")
                .header("cookie", &owner.cookie)
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(without_csrf.status(), StatusCode::FORBIDDEN);
}

async fn change_role(app: &Router, owner: &Browser, user: &Browser, role: &str) {
    let members = data(
        request(
            app,
            owner,
            "GET",
            "/api/v1/organization/members",
            json!(null),
        )
        .await,
    )
    .await;
    let current = members["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|member| member["user_id"] == user.id)
        .unwrap();
    let response = request(
        app,
        owner,
        "PUT",
        &format!("/api/v1/organization/members/{}", user.id),
        json!({"version":current["version"],"role":role,"active":true}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}
fn sample(
    at: chrono::DateTime<chrono::Utc>,
    errors: f64,
) -> saas_app::modules::system::monitoring::ErrorSample {
    saas_app::modules::system::monitoring::ErrorSample {
        sampled_at: at,
        requests: 200.0,
        errors,
    }
}
#[sqlx::test(migrations = "../../migrations")]
async fn sustained_errors_notify_current_administrators_once_and_missing_data_is_not_recovery(
    pool: PgPool,
) {
    use chrono::{Duration, Utc};
    use saas_app::modules::system::monitoring_alerts::evaluate_at;
    let app = saas_app::router(pool.clone());
    let owner = register(&app, "incident-owner@example.test").await;
    let admin = register(&app, "incident-admin@example.test").await;
    let member = register(&app, "incident-member@example.test").await;
    change_role(&app, &owner, &admin, "admin").await;
    assert_eq!(
        request(
            &app,
            &owner,
            "PUT",
            RULE,
            json!({"version":1,"enabled":true,"error_rate_percent":1.0,"duration_minutes":1})
        )
        .await
        .status(),
        StatusCode::OK
    );
    let start = Utc::now();
    for seconds in [0, 30] {
        let at = start + Duration::seconds(seconds);
        evaluate_at(&pool, Some(sample(at, 10.0)), at)
            .await
            .unwrap();
        let inbox =
            data(request(&app, &owner, "GET", "/api/v1/notifications", json!(null)).await).await;
        assert_eq!(inbox["unread_count"], 0);
    }
    let firing_at = start + Duration::seconds(60);
    let (one, two) = tokio::join!(
        evaluate_at(&pool, Some(sample(firing_at, 10.0)), firing_at),
        evaluate_at(&pool, Some(sample(firing_at, 10.0)), firing_at)
    );
    one.unwrap();
    two.unwrap();
    let inbox =
        data(request(&app, &owner, "GET", "/api/v1/notifications", json!(null)).await).await;
    assert_eq!(inbox["unread_count"], 1);
    assert_eq!(inbox["data"][0]["outcome"], "firing");
    let admin_inbox =
        data(request(&app, &admin, "GET", "/api/v1/notifications", json!(null)).await).await;
    assert_eq!(admin_inbox["unread_count"], 1);
    let member_inbox =
        data(request(&app, &member, "GET", "/api/v1/notifications", json!(null)).await).await;
    assert_eq!(member_inbox["unread_count"], 0);
    let unknown_at = start + Duration::seconds(90);
    evaluate_at(&pool, None, unknown_at).await.unwrap();
    assert_eq!(
        data(request(&app, &owner, "GET", RULE, json!(null)).await).await["state"],
        "no_data"
    );
    assert_eq!(
        data(request(&app, &owner, "GET", "/api/v1/notifications", json!(null)).await).await["unread_count"],
        1
    );
    change_role(&app, &owner, &admin, "member").await;
    let recovered_at = start + Duration::seconds(120);
    evaluate_at(&pool, Some(sample(recovered_at, 0.0)), recovered_at)
        .await
        .unwrap();
    evaluate_at(&pool, Some(sample(recovered_at, 0.0)), recovered_at)
        .await
        .unwrap();
    let recovered =
        data(request(&app, &owner, "GET", "/api/v1/notifications", json!(null)).await).await;
    assert_eq!(recovered["data"].as_array().unwrap().len(), 2);
    assert_eq!(recovered["data"][0]["outcome"], "recovered");
    assert_eq!(
        data(request(&app, &admin, "GET", "/api/v1/notifications", json!(null)).await).await["unread_count"],
        1
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn sparse_stale_repeated_samples_and_long_gaps_cannot_advance_an_incident(pool: PgPool) {
    use chrono::{Duration, Utc};
    use saas_app::modules::system::{monitoring::ErrorSample, monitoring_alerts::evaluate_at};
    let app = saas_app::router(pool.clone());
    let owner = register(&app, "sparse-owner@example.test").await;
    assert_eq!(
        request(
            &app,
            &owner,
            "PUT",
            RULE,
            json!({"version":1,"enabled":true,"error_rate_percent":1.0,"duration_minutes":1})
        )
        .await
        .status(),
        StatusCode::OK
    );
    let start = Utc::now();
    evaluate_at(
        &pool,
        Some(ErrorSample {
            sampled_at: start,
            requests: 50.0,
            errors: 25.0,
        }),
        start,
    )
    .await
    .unwrap();
    assert_eq!(
        data(request(&app, &owner, "GET", RULE, json!(null)).await).await["state"],
        "no_data"
    );
    let pending = start + Duration::seconds(10);
    evaluate_at(&pool, Some(sample(pending, 10.0)), pending)
        .await
        .unwrap();
    evaluate_at(
        &pool,
        Some(sample(pending, 10.0)),
        pending + Duration::seconds(60),
    )
    .await
    .unwrap();
    let gap = pending + Duration::seconds(190);
    evaluate_at(&pool, Some(sample(gap, 10.0)), gap)
        .await
        .unwrap();
    evaluate_at(
        &pool,
        Some(sample(gap + Duration::seconds(30), 10.0)),
        gap + Duration::seconds(30),
    )
    .await
    .unwrap();
    assert_eq!(
        data(request(&app, &owner, "GET", "/api/v1/notifications", json!(null)).await).await["unread_count"],
        0
    );
    let fire = gap + Duration::seconds(60);
    evaluate_at(&pool, Some(sample(fire, 10.0)), fire)
        .await
        .unwrap();
    assert_eq!(
        data(request(&app, &owner, "GET", "/api/v1/notifications", json!(null)).await).await["unread_count"],
        1
    );
    let unknown = fire + Duration::seconds(30);
    evaluate_at(
        &pool,
        Some(ErrorSample {
            sampled_at: unknown,
            requests: 20.0,
            errors: 0.0,
        }),
        unknown,
    )
    .await
    .unwrap();
    evaluate_at(
        &pool,
        Some(sample(start, 0.0)),
        unknown + Duration::seconds(30),
    )
    .await
    .unwrap();
    assert_eq!(
        data(request(&app, &owner, "GET", RULE, json!(null)).await).await["state"],
        "no_data"
    );
    assert_eq!(
        data(request(&app, &owner, "GET", "/api/v1/notifications", json!(null)).await).await["unread_count"],
        1
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn alert_writes_reject_members_missing_csrf_and_invalid_rules_without_changing_settings(
    pool: PgPool,
) {
    let app = saas_app::router(pool);
    let owner = register(&app, "write-owner@example.test").await;
    let member = register(&app, "write-member@example.test").await;
    let change = json!({"version":1,"enabled":true,"error_rate_percent":2.0,"duration_minutes":1});
    assert_eq!(
        request(&app, &member, "PUT", RULE, change.clone())
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let missing_csrf = app
        .clone()
        .oneshot(
            Request::put(RULE)
                .header("cookie", &owner.cookie)
                .header("origin", "http://127.0.0.1:15400")
                .header("content-type", "application/json")
                .body(Body::from(change.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);
    let invalid = json!({"version":1,"enabled":true,"error_rate_percent":0.0,"duration_minutes":2});
    assert_eq!(
        request(&app, &owner, "PUT", RULE, invalid).await.status(),
        StatusCode::BAD_REQUEST
    );
    let response = request(&app, &owner, "GET", RULE, json!(null)).await;
    assert_eq!(response.headers()["cache-control"], "no-store");
    let rule = data(response).await;
    assert_eq!(rule["version"], 1);
    assert_eq!(rule["enabled"], false);
}
