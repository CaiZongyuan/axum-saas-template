pub use saas_app::{http, modules};
#[path = "../../../examples/tutorial-tickets/mod.rs"]
mod tickets;

use axum::{Router, body::Body, http::Request, response::Response};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

struct Actor {
    cookie: String,
    csrf: String,
}

async fn body(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}

async fn register(app: &Router, email: &str) -> Actor {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/auth/register")
                .header("origin", "http://127.0.0.1:5173")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"email":email,"password":"tutorial-test-password"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 201);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let json = body(response).await;
    Actor {
        cookie,
        csrf: json["csrf_token"].as_str().unwrap().to_owned(),
    }
}

async fn request(
    app: &Router,
    actor: &Actor,
    method: &str,
    path: &str,
    input: Value,
    key: &str,
) -> Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("origin", "http://127.0.0.1:5173")
                .header("content-type", "application/json")
                .header("cookie", &actor.cookie)
                .header("x-csrf-token", &actor.csrf)
                .header("idempotency-key", key)
                .body(if method == "GET" {
                    Body::empty()
                } else {
                    Body::from(input.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn application(pool: PgPool) -> Router {
    install_course(&pool).await;
    let auth = saas_platform::config::AuthSettings::default();
    let mut document = saas_app::openapi();
    document.merge(tickets::openapi());
    saas_app::compose_routes(
        pool.clone(),
        auth.clone(),
        tickets::router(pool, auth, None),
        document,
    )
}

async fn install_course(pool: &PgPool) {
    sqlx::raw_sql(include_str!(
        "../../../examples/tutorial-tickets/migrations/0001_tickets.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../examples/tutorial-tickets/migrations/0002_attachments.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../examples/tutorial-tickets/migrations/0003_exports.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
}

// region:crud-test
#[sqlx::test(migrations = "../../migrations")]
async fn a_developer_can_create_and_read_a_persistent_ticket(pool: PgPool) {
    let app = application(pool).await;
    let actor = register(&app, "writer@example.test").await;
    let response = request(
        &app,
        &actor,
        "POST",
        "/api/v1/tickets",
        json!({"title":"First ticket","description":"Investigate a request"}),
        "first-ticket",
    )
    .await;
    assert_eq!(response.status(), 201);
    let ticket = body(response).await;
    assert_eq!(ticket["title"], "First ticket");
    assert_eq!(ticket["status"], "open");
    assert_eq!(ticket["version"], 1);
    let response = request(
        &app,
        &actor,
        "GET",
        &format!("/api/v1/tickets/{}", ticket["id"].as_str().unwrap()),
        Value::Null,
        "",
    )
    .await;
    assert_eq!(response.status(), 200);
    assert_eq!(body(response).await, ticket);
}

// endregion:crud-test
#[sqlx::test(migrations = "../../migrations")]
async fn invalid_ticket_input_never_creates_a_resource(pool: PgPool) {
    let app = application(pool).await;
    let actor = register(&app, "validation@example.test").await;
    for (key, input) in [
        (
            "empty",
            json!({"title":"   ","description":"invalid title"}),
        ),
        (
            "large",
            json!({"title":"Too large","description":"x".repeat(8193)}),
        ),
        (
            "unknown",
            json!({"title":"Extra field","description":"","created_by":"someone"}),
        ),
        ("", json!({"title":"Invalid key","description":""})),
    ] {
        let response = request(&app, &actor, "POST", "/api/v1/tickets", input, key).await;
        assert_eq!(response.status(), 400);
        assert!(body(response).await["error"]["code"].as_str().is_some());
    }
    let oversized = request(
        &app,
        &actor,
        "POST",
        "/api/v1/tickets",
        json!({"title":"Body budget","description":"x".repeat(17 * 1024)}),
        "body",
    )
    .await;
    assert_eq!(oversized.status(), 413);
    assert_eq!(
        body(request(&app, &actor, "GET", "/api/v1/tickets", Value::Null, "").await).await,
        json!([])
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn creation_replays_one_result_and_rejects_changed_input(pool: PgPool) {
    let app = application(pool).await;
    let actor = register(&app, "retry@example.test").await;
    let input = json!({"title":"  One operation  ","description":"same content"});
    let first = request(
        &app,
        &actor,
        "POST",
        "/api/v1/tickets",
        input.clone(),
        "same-operation",
    )
    .await;
    assert_eq!(first.status(), 201);
    let first = body(first).await;
    let second = request(
        &app,
        &actor,
        "POST",
        "/api/v1/tickets",
        input,
        "same-operation",
    )
    .await;
    assert_eq!(second.status(), 201);
    assert_eq!(body(second).await, first);
    let changed = request(
        &app,
        &actor,
        "POST",
        "/api/v1/tickets",
        json!({"title":"Changed","description":"same content"}),
        "same-operation",
    )
    .await;
    assert_eq!(changed.status(), 409);
}

#[sqlx::test(migrations = "../../migrations")]
async fn two_updates_of_one_version_have_one_winner(pool: PgPool) {
    let app = application(pool).await;
    let actor = register(&app, "editor@example.test").await;
    let ticket = body(
        request(
            &app,
            &actor,
            "POST",
            "/api/v1/tickets",
            json!({"title":"Original","description":"original"}),
            "create",
        )
        .await,
    )
    .await;
    let path = format!("/api/v1/tickets/{}", ticket["id"].as_str().unwrap());
    let (a, b) = tokio::join!(
        request(
            &app,
            &actor,
            "PUT",
            &path,
            json!({"title":"First","description":"first","status":"closed","version":1}),
            ""
        ),
        request(
            &app,
            &actor,
            "PUT",
            &path,
            json!({"title":"Second","description":"second","status":"open","version":1}),
            ""
        ),
    );
    let mut status = [a.status().as_u16(), b.status().as_u16()];
    status.sort();
    assert_eq!(status, [200, 409]);
    let winner = if a.status() == 200 {
        body(a).await
    } else {
        body(b).await
    };
    let current = body(request(&app, &actor, "GET", &path, Value::Null, "").await).await;
    assert_eq!(current, winner);
    assert_eq!(current["version"], 2);
}

#[sqlx::test(migrations = "../../migrations")]
async fn a_failed_audit_rolls_back_ticket_and_request_replay(pool: PgPool) {
    let app = application(pool.clone()).await;
    let actor = register(&app, "transaction@example.test").await;
    sqlx::raw_sql("CREATE FUNCTION support.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'tickets.create' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_ticket_audit BEFORE INSERT ON saas_core.audit_events FOR EACH ROW EXECUTE FUNCTION support.reject_audit();")
        .execute(&pool).await.unwrap();
    let input = json!({"title":"Atomic operation","description":"rollback evidence"});
    let failed = request(
        &app,
        &actor,
        "POST",
        "/api/v1/tickets",
        input.clone(),
        "retry-after-rollback",
    )
    .await;
    assert_eq!(failed.status(), 503);
    let list = request(&app, &actor, "GET", "/api/v1/tickets", Value::Null, "").await;
    assert_eq!(list.status(), 200);
    assert_eq!(body(list).await.as_array().unwrap().len(), 0);
    sqlx::query("DROP TRIGGER reject_ticket_audit ON saas_core.audit_events")
        .execute(&pool)
        .await
        .unwrap();
    let recovered = request(
        &app,
        &actor,
        "POST",
        "/api/v1/tickets",
        input,
        "retry-after-rollback",
    )
    .await;
    assert_eq!(recovered.status(), 201);
    let list = body(request(&app, &actor, "GET", "/api/v1/tickets", Value::Null, "").await).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
}

#[sqlx::test(migrations = "../../migrations")]
async fn private_resources_and_deleted_replays_are_reauthorized(pool: PgPool) {
    let app = application(pool).await;
    let _operator = register(&app, "operator@example.test").await;
    let writer = register(&app, "member@example.test").await;
    let other = register(&app, "other@example.test").await;
    let input = json!({"title":"Private ticket","description":"member content"});
    let ticket = body(
        request(
            &app,
            &writer,
            "POST",
            "/api/v1/tickets",
            input.clone(),
            "private",
        )
        .await,
    )
    .await;
    let path = format!("/api/v1/tickets/{}", ticket["id"].as_str().unwrap());
    assert_eq!(
        request(&app, &other, "GET", &path, Value::Null, "")
            .await
            .status(),
        404
    );
    assert_eq!(
        request(&app, &writer, "DELETE", &path, Value::Null, "")
            .await
            .status(),
        204
    );
    assert_eq!(
        request(&app, &writer, "GET", &path, Value::Null, "")
            .await
            .status(),
        404
    );
    let replay = request(&app, &writer, "POST", "/api/v1/tickets", input, "private").await;
    assert_eq!(replay.status(), 404);
    let list = body(request(&app, &writer, "GET", "/api/v1/tickets", Value::Null, "").await).await;
    assert_eq!(list, json!([]));
}

async fn storage_application(pool: PgPool) -> (Router, modules::files::FileService) {
    use saas_platform::object_storage::{S3ObjectStorage, StorageSettings};
    let settings = StorageSettings {
        endpoint: std::env::var("S3_ENDPOINT").expect("run the isolated tutorial services"),
        public_endpoint: std::env::var("S3_PUBLIC_ENDPOINT").unwrap(),
        region: "us-east-1".into(),
        bucket: format!("tutorial-{}", uuid::Uuid::now_v7()),
        access_key: std::env::var("S3_ACCESS_KEY").unwrap(),
        secret_key: std::env::var("S3_SECRET_KEY").unwrap(),
    };
    let storage = std::sync::Arc::new(S3ObjectStorage::new(&settings));
    storage
        .bootstrap(&settings.bucket, "http://127.0.0.1:5173")
        .await
        .unwrap();
    let files = modules::files::FileService::new(storage, settings.bucket, Default::default());
    install_course(&pool).await;
    let auth = saas_platform::config::AuthSettings::default();
    let mut contract = saas_app::openapi();
    contract.merge(tickets::openapi());
    (
        saas_app::compose_routes(
            pool.clone(),
            auth.clone(),
            tickets::router(pool, auth, Some(files.clone())),
            contract,
        ),
        files,
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn ticket_attachments_publish_verified_bytes_and_download_them(pool: PgPool) {
    use sha2::{Digest, Sha256};
    let (app, files) = storage_application(pool.clone()).await;
    let actor = register(&app, "attachment@example.test").await;
    let ticket = body(
        request(
            &app,
            &actor,
            "POST",
            "/api/v1/tickets",
            json!({"title":"A file","description":"verified bytes"}),
            "ticket",
        )
        .await,
    )
    .await;
    let prefix = format!("/api/v1/tickets/{}", ticket["id"].as_str().unwrap());
    let bytes = b"tutorial attachment bytes";
    let upload = request(&app, &actor, "POST", &format!("{prefix}/uploads"), json!({"file_name":"evidence.txt","content_type":"text/plain","size":bytes.len(),"sha256":hex::encode(Sha256::digest(bytes))}), "upload").await;
    assert_eq!(upload.status(), 201);
    let upload = body(upload).await;
    let mut put = reqwest::Client::new()
        .put(upload["upload"]["url"].as_str().unwrap())
        .body(bytes.to_vec());
    for (key, value) in upload["upload"]["headers"].as_object().unwrap() {
        put = put.header(key, value.as_str().unwrap());
    }
    let sent = put
        .send()
        .await
        .unwrap_or_else(|_| panic!("Upload transport failed"));
    assert!(sent.status().is_success());
    let id = upload["upload_id"].as_str().unwrap();
    let completed = request(
        &app,
        &actor,
        "POST",
        &format!("{prefix}/uploads/{id}/complete"),
        Value::Null,
        "",
    )
    .await;
    assert_eq!(completed.status(), 200);
    let download = request(
        &app,
        &actor,
        "GET",
        &format!("{prefix}/attachments/{id}/download"),
        Value::Null,
        "",
    )
    .await;
    assert_eq!(download.status(), 200);
    let cap = body(download).await;
    let response = reqwest::get(cap["url"].as_str().unwrap())
        .await
        .unwrap_or_else(|_| panic!("Download transport failed"));
    assert!(response.status().is_success());
    assert_eq!(
        response
            .bytes()
            .await
            .unwrap_or_else(|_| panic!("Download body failed"))
            .as_ref(),
        bytes
    );
    assert_eq!(
        request(&app, &actor, "DELETE", &prefix, Value::Null, "")
            .await
            .status(),
        204
    );
    assert_eq!(
        request(
            &app,
            &actor,
            "GET",
            &format!("{prefix}/attachments/{id}/download"),
            Value::Null,
            ""
        )
        .await
        .status(),
        404
    );
    let cleanup = modules::jobs::Worker::new(
        pool.clone(),
        vec![modules::files::cleanup_handler(pool, files)],
        Default::default(),
    );
    assert!(cleanup.run_once().await.unwrap());
    let removed = reqwest::get(cap["url"].as_str().unwrap())
        .await
        .unwrap_or_else(|_| panic!("Attachment cleanup verification failed"));
    assert_eq!(removed.status(), 404);
}

async fn export_request(app: &Router, actor: &Actor) -> (String, Value) {
    let ticket = body(
        request(
            app,
            actor,
            "POST",
            "/api/v1/tickets",
            json!({"title":"Captured title","description":"request-time content"}),
            "ticket",
        )
        .await,
    )
    .await;
    let prefix = format!("/api/v1/tickets/{}", ticket["id"].as_str().unwrap());
    let response = request(
        app,
        actor,
        "POST",
        &format!("{prefix}/exports"),
        json!({}),
        "export",
    )
    .await;
    assert_eq!(response.status(), 202);
    let export = body(response).await;
    let replay = request(
        app,
        actor,
        "POST",
        &format!("{prefix}/exports"),
        json!({}),
        "export",
    )
    .await;
    assert_eq!(replay.status(), 202);
    assert_eq!(body(replay).await["id"], export["id"]);
    (prefix, export)
}

fn export_worker(pool: PgPool, files: modules::files::FileService) -> modules::jobs::Worker {
    modules::jobs::Worker::new(
        pool.clone(),
        vec![tickets::export_handler(pool, files, Default::default())],
        Default::default(),
    )
}

async fn export_status(app: &Router, actor: &Actor, prefix: &str, export: &Value) -> Value {
    let response = request(
        app,
        actor,
        "GET",
        &format!("{prefix}/exports/{}", export["id"].as_str().unwrap()),
        Value::Null,
        "",
    )
    .await;
    assert_eq!(response.status(), 200);
    body(response).await
}

#[sqlx::test(migrations = "../../migrations")]
async fn ticket_exports_publish_the_snapshot_notify_and_expire(pool: PgPool) {
    let (app, files) = storage_application(pool.clone()).await;
    let _owner = register(&app, "export-owner@example.test").await;
    let actor = register(&app, "export-author@example.test").await;
    let other = register(&app, "export-other@example.test").await;
    let (prefix, export) = export_request(&app, &actor).await;
    let notices = body(
        request(
            &app,
            &actor,
            "GET",
            "/api/v1/notifications",
            Value::Null,
            "",
        )
        .await,
    )
    .await;
    assert_eq!(notices["unread_count"], 0);
    assert_eq!(request(&app, &actor, "PUT", &prefix, json!({"title":"Later title","description":"later content","status":"closed","version":1}), "").await.status(), 200);
    let worker = export_worker(pool.clone(), files.clone());
    assert!(worker.run_once().await.unwrap());
    assert!(!worker.run_once().await.unwrap());
    assert_eq!(
        export_status(&app, &actor, &prefix, &export).await["status"],
        "succeeded"
    );
    let download_path = format!(
        "{prefix}/exports/{}/download",
        export["id"].as_str().unwrap()
    );
    assert_eq!(
        request(&app, &other, "GET", &download_path, Value::Null, "")
            .await
            .status(),
        404
    );
    let capability =
        body(request(&app, &actor, "GET", &download_path, Value::Null, "").await).await;
    let response = reqwest::get(capability["url"].as_str().unwrap())
        .await
        .unwrap_or_else(|_| panic!("Export transport failed"));
    assert!(response.status().is_success());
    let bytes = response
        .bytes()
        .await
        .unwrap_or_else(|_| panic!("Export body failed"));
    assert!(bytes.len() <= 64 * 1024);
    let document: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(document["ticket"]["title"], "Captured title");
    assert_eq!(document["attachments"], json!([]));
    let notices = body(
        request(
            &app,
            &actor,
            "GET",
            "/api/v1/notifications",
            Value::Null,
            "",
        )
        .await,
    )
    .await;
    assert_eq!(notices["unread_count"], 1);
    assert_eq!(notices["data"][0]["target"]["resource_id"], export["id"]);
    sqlx::query(
        "UPDATE support.exports SET expires_at = now() - interval '1 second' WHERE id = $1::uuid",
    )
    .bind(export["id"].as_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(&app, &actor, "GET", &download_path, Value::Null, "")
            .await
            .status(),
        410
    );
    tickets::export_maintenance(pool.clone())
        .schedule()
        .await
        .unwrap();
    let cleanup = modules::jobs::Worker::new(
        pool.clone(),
        vec![modules::files::cleanup_handler(pool.clone(), files)],
        Default::default(),
    );
    assert!(cleanup.run_once().await.unwrap());
    let old = reqwest::get(capability["url"].as_str().unwrap())
        .await
        .unwrap_or_else(|_| panic!("Cleanup verification failed"));
    assert_eq!(old.status(), 404);
}

#[sqlx::test(migrations = "../../migrations")]
async fn ticket_exports_reject_the_revoked_original_session(pool: PgPool) {
    let (app, files) = storage_application(pool.clone()).await;
    let actor = register(&app, "revoked-export@example.test").await;
    let (prefix, export) = export_request(&app, &actor).await;
    assert_eq!(
        request(&app, &actor, "POST", "/api/v1/auth/logout", json!({}), "")
            .await
            .status(),
        204
    );
    assert!(export_worker(pool.clone(), files).run_once().await.unwrap());
    let login = app.clone().oneshot(Request::post("/api/v1/auth/login").header("origin", "http://127.0.0.1:5173").header("content-type", "application/json").body(Body::from(json!({"email":"revoked-export@example.test","password":"tutorial-test-password"}).to_string())).unwrap()).await.unwrap();
    assert_eq!(login.status(), 200);
    let cookie = login.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let csrf = body(login).await["csrf_token"].as_str().unwrap().to_owned();
    let fresh = Actor { cookie, csrf };
    assert_eq!(
        export_status(&app, &fresh, &prefix, &export).await["status"],
        "failed"
    );
    assert_eq!(
        request(
            &app,
            &fresh,
            "GET",
            &format!(
                "{prefix}/exports/{}/download",
                export["id"].as_str().unwrap()
            ),
            Value::Null,
            ""
        )
        .await
        .status(),
        409
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn ticket_exports_fence_old_leases_and_retry_atomic_publication(pool: PgPool) {
    use modules::jobs::{self, JobError};
    let (app, files) = storage_application(pool.clone()).await;
    let actor = register(&app, "atomic-export@example.test").await;
    let (prefix, export) = export_request(&app, &actor).await;
    let old = jobs::claim(&pool, &["tickets.export"], "old-worker", 60)
        .await
        .unwrap()
        .unwrap();
    sqlx::query("UPDATE saas_core.jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1::uuid").bind(&old.id).execute(&pool).await.unwrap();
    let current = jobs::claim(&pool, &["tickets.export"], "new-worker", 60)
        .await
        .unwrap()
        .unwrap();
    let handler = tickets::export_handler(pool.clone(), files.clone(), Default::default());
    assert!(matches!(handler.run(&old).await, Err(JobError::LostLease)));
    sqlx::raw_sql("CREATE FUNCTION support.reject_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled notification failure'; END $$; CREATE TRIGGER reject_course_notice BEFORE INSERT ON saas_core.notifications FOR EACH ROW EXECUTE FUNCTION support.reject_notice();").execute(&pool).await.unwrap();
    let failed = handler.run(&current).await.unwrap_err();
    current.fail(&pool, &failed).await.unwrap();
    assert_eq!(
        export_status(&app, &actor, &prefix, &export).await["status"],
        "retry_wait"
    );
    assert_eq!(
        request(
            &app,
            &actor,
            "GET",
            &format!(
                "{prefix}/exports/{}/download",
                export["id"].as_str().unwrap()
            ),
            Value::Null,
            ""
        )
        .await
        .status(),
        409
    );
    sqlx::query("DROP TRIGGER reject_course_notice ON saas_core.notifications")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE saas_core.jobs SET scheduled_at = now() - interval '1 second' WHERE id = $1::uuid",
    )
    .bind(&current.id)
    .execute(&pool)
    .await
    .unwrap();
    assert!(export_worker(pool.clone(), files).run_once().await.unwrap());
    assert_eq!(
        export_status(&app, &actor, &prefix, &export).await["status"],
        "succeeded"
    );
    let notices = body(
        request(
            &app,
            &actor,
            "GET",
            "/api/v1/notifications",
            Value::Null,
            "",
        )
        .await,
    )
    .await;
    assert_eq!(notices["unread_count"], 1);
}
