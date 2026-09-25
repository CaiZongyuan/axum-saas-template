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

#[sqlx::test(migrations = "../../migrations")]
async fn document_writes_require_a_session_trusted_origin_and_csrf(pool: PgPool) {
    let app = application(pool.clone());
    let writer = register(&app, "writer@example.com").await;
    for (cookie, origin, csrf, expected) in [
        (
            None,
            "http://127.0.0.1:5173",
            Some(writer.csrf.as_str()),
            StatusCode::UNAUTHORIZED,
        ),
        (
            Some(writer.cookie.as_str()),
            "https://attacker.test",
            Some(writer.csrf.as_str()),
            StatusCode::FORBIDDEN,
        ),
        (
            Some(writer.cookie.as_str()),
            "http://127.0.0.1:5173",
            None,
            StatusCode::FORBIDDEN,
        ),
        (
            Some(writer.cookie.as_str()),
            "http://127.0.0.1:5173",
            Some("wrong"),
            StatusCode::FORBIDDEN,
        ),
    ] {
        let mut request = Request::post("/api/v1/knowledge/documents")
            .header("origin", origin)
            .header("content-type", "application/json")
            .header("idempotency-key", "auth-check");
        if let Some(cookie) = cookie {
            request = request.header("cookie", cookie);
        }
        if let Some(csrf) = csrf {
            request = request.header("x-csrf-token", csrf);
        }
        let response = app
            .clone()
            .oneshot(
                request
                    .body(Body::from(
                        json!({"title":"blocked", "markdown":"body"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        assert!(data(response).await["error"]["request_id"].is_string());
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM knowledge.documents")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn malformed_document_paths_and_queries_keep_the_public_error_envelope(pool: PgPool) {
    let app = application(pool);
    let writer = register(&app, "writer@example.com").await;
    for path in [
        "/api/v1/knowledge/documents/%FF",
        "/api/v1/knowledge/documents?limit=invalid",
        "/api/v1/knowledge/documents?cursor=broken",
        "/api/v1/knowledge/documents?limit=101",
    ] {
        let response = get(&app, &writer, path).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(data(response).await["error"]["request_id"].is_string());
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn concurrent_duplicate_keys_create_one_document_and_expired_keys_can_be_reused(
    pool: PgPool,
) {
    let app = application(pool.clone());
    let writer = register(&app, "writer@example.com").await;
    assert_eq!(
        create(&app, &writer, "准备个人库", "warmup").await.status(),
        StatusCode::CREATED
    );
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE saas_core.idempotency_records IN SHARE MODE")
        .execute(&mut *gate)
        .await
        .unwrap();
    let release = async {
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let waiting: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'").fetch_one(&pool).await.unwrap();
                if waiting >= 2 { break; }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }).await.expect("two requests must contend on idempotency storage");
        gate.rollback().await.unwrap();
    };
    let (a, b, ()) = tokio::join!(
        create_with_key(&app, &writer, "只创建一次", "same", "concurrent-key"),
        create_with_key(&app, &writer, "只创建一次", "same", "concurrent-key"),
        release
    );
    assert_eq!(a.status(), StatusCode::CREATED);
    assert_eq!(b.status(), StatusCode::CREATED);
    let first = data(a).await;
    assert_eq!(data(b).await, first);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM knowledge.documents")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
    sqlx::query("UPDATE saas_core.idempotency_records SET expires_at = now() - interval '1 second' WHERE request_key = 'concurrent-key'").execute(&pool).await.unwrap();
    let reused = create_with_key(&app, &writer, "过期后的新请求", "new", "concurrent-key").await;
    assert_eq!(reused.status(), StatusCode::CREATED);
    assert_ne!(data(reused).await["id"], first["id"]);
}

#[sqlx::test(migrations = "../../migrations")]
async fn invalid_document_content_is_rejected_without_initializing_a_library(pool: PgPool) {
    let app = application(pool.clone());
    let writer = register(&app, "writer@example.com").await;
    for (title, markdown, expected) in [
        ("   ".into(), "body".into(), StatusCode::BAD_REQUEST),
        ("字".repeat(201), "body".into(), StatusCode::BAD_REQUEST),
        ("title\0".into(), "body".into(), StatusCode::BAD_REQUEST),
        ("title".into(), "body\0".into(), StatusCode::BAD_REQUEST),
        (
            "title".into(),
            "x".repeat(1024 * 1024 + 1),
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
    ] {
        let response = create(&app, &writer, &title, &markdown).await;
        assert_eq!(response.status(), expected);
        assert!(data(response).await["error"]["request_id"].is_string());
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM knowledge.knowledge_bases")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

fn application(pool: PgPool) -> Router {
    saas_api::router(pool, Default::default())
}

async fn data(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}

struct Browser {
    cookie: String,
    csrf: String,
}

async fn register(app: &Router, email: &str) -> Browser {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/auth/register")
                .header("origin", "http://127.0.0.1:5173")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"email":email, "password":"a-long-test-password"}).to_string(),
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
    Browser {
        cookie,
        csrf: data(response).await["csrf_token"]
            .as_str()
            .unwrap()
            .to_owned(),
    }
}

async fn create(app: &Router, actor: &Browser, title: &str, markdown: &str) -> Response {
    create_with_key(
        app,
        actor,
        title,
        markdown,
        &uuid::Uuid::now_v7().to_string(),
    )
    .await
}

async fn create_with_key(
    app: &Router,
    actor: &Browser,
    title: &str,
    markdown: &str,
    key: &str,
) -> Response {
    app.clone()
        .oneshot(
            Request::post("/api/v1/knowledge/documents")
                .header("origin", "http://127.0.0.1:5173")
                .header("content-type", "application/json")
                .header("cookie", &actor.cookie)
                .header("x-csrf-token", &actor.csrf)
                .header("idempotency-key", key)
                .body(Body::from(
                    json!({"title":title,"markdown":markdown}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn get(app: &Router, actor: &Browser, path: &str) -> Response {
    app.clone()
        .oneshot(
            Request::get(path)
                .header("cookie", &actor.cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
async fn a_member_can_create_and_read_their_first_document_without_admin_setup(pool: PgPool) {
    let app = application(pool);
    register(&app, "owner@example.com").await;
    let member = register(&app, "writer@example.com").await;
    let created = create(&app, &member, "我的第一篇文档", "# 开始\n\n这是正文。").await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let document = data(created).await;
    assert_eq!(document["version"], 1);
    assert_eq!(document["title"], "我的第一篇文档");
    let id = document["id"].as_str().unwrap();
    let read = get(&app, &member, &format!("/api/v1/knowledge/documents/{id}")).await;
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(
        read.headers()
            .get("cache-control")
            .and_then(|value| value.to_str().ok()),
        Some("no-store")
    );
    assert_eq!(data(read).await, document);
}

#[sqlx::test(migrations = "../../migrations")]
async fn retried_document_creation_replays_one_result_and_rejects_changed_payload(pool: PgPool) {
    let app = application(pool);
    let member = register(&app, "writer@example.com").await;
    let first = create_with_key(&app, &member, "同一个请求", "正文", "stable-request-key").await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let first = data(first).await;
    let retried = create_with_key(&app, &member, "同一个请求", "正文", "stable-request-key").await;
    assert_eq!(retried.status(), StatusCode::CREATED);
    assert_eq!(data(retried).await, first);
    let changed = create_with_key(&app, &member, "不同内容", "正文", "stable-request-key").await;
    assert_eq!(changed.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "../../migrations")]
async fn private_documents_require_a_grant_and_initialization_never_restores_revoked_access(
    pool: PgPool,
) {
    let app = application(pool.clone());
    let owner = register(&app, "owner@example.com").await;
    let writer = register(&app, "writer@example.com").await;
    let other = register(&app, "other@example.com").await;
    let document =
        data(create_with_key(&app, &writer, "私密标题", "私密内容", "private-key").await).await;
    let path = format!(
        "/api/v1/knowledge/documents/{}",
        document["id"].as_str().unwrap()
    );
    let denied = get(&app, &other, &path).await;
    assert_eq!(denied.status(), StatusCode::NOT_FOUND);
    assert!(!data(denied).await.to_string().contains("私密"));
    assert_eq!(get(&app, &owner, &path).await.status(), StatusCode::OK);
    sqlx::query("DELETE FROM knowledge.grants WHERE knowledge_base_id = $1::uuid")
        .bind(document["knowledge_base_id"].as_str().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        get(&app, &writer, &path).await.status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        create_with_key(&app, &writer, "私密标题", "私密内容", "private-key")
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        create(&app, &writer, "新的请求也不能恢复授权", "正文")
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM knowledge.knowledge_bases")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM knowledge.grants")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn concurrent_first_writes_prepare_one_library_and_grant(pool: PgPool) {
    let app = application(pool.clone());
    let writer = register(&app, "writer@example.com").await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE knowledge.knowledge_bases IN SHARE MODE")
        .execute(&mut *gate)
        .await
        .unwrap();
    let release = async {
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let waiting: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'").fetch_one(&pool).await.unwrap();
                if waiting >= 2 { break; }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }).await.expect("two writes must reach the initialization gate");
        gate.rollback().await.unwrap();
    };
    let (first, second, ()) = tokio::join!(
        create(&app, &writer, "第一篇", "A"),
        create(&app, &writer, "第二篇", "B"),
        release
    );
    assert_eq!(first.status(), StatusCode::CREATED);
    assert_eq!(second.status(), StatusCode::CREATED);
    assert_eq!(
        data(first).await["knowledge_base_id"],
        data(second).await["knowledge_base_id"]
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM knowledge.knowledge_bases")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM knowledge.grants")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM knowledge.documents")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn failed_document_audit_rolls_back_library_grant_document_and_idempotency(pool: PgPool) {
    let app = application(pool.clone());
    let writer = register(&app, "writer@example.com").await;
    sqlx::raw_sql("CREATE FUNCTION knowledge.reject_document_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'knowledge.document.create' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_document_audit BEFORE INSERT ON saas_core.audit_events FOR EACH ROW EXECUTE FUNCTION knowledge.reject_document_audit();").execute(&pool).await.unwrap();
    assert_eq!(
        create_with_key(&app, &writer, "事务测试", "正文", "retry-after-rollback")
            .await
            .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    for table in [
        "knowledge.knowledge_bases",
        "knowledge.grants",
        "knowledge.documents",
        "saas_core.idempotency_records",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap(),
            0,
            "{table}"
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM saas_core.audit_events WHERE action LIKE 'knowledge.%'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    sqlx::query("DROP TRIGGER reject_document_audit ON saas_core.audit_events")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        create_with_key(&app, &writer, "事务测试", "正文", "retry-after-rollback")
            .await
            .status(),
        StatusCode::CREATED
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn search_rejects_overlong_and_nul_keywords_with_a_public_error(pool: PgPool) {
    let app = application(pool);
    let writer = register(&app, "writer@example.com").await;
    for keyword in ["x".repeat(201), "%00".into()] {
        let response = get(
            &app,
            &writer,
            &format!("/api/v1/knowledge/documents?q={keyword}"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let error = data(response).await;
        assert_eq!(error["error"]["code"], "knowledge.invalid_search");
        assert!(error["error"]["request_id"].is_string());
    }
    assert_eq!(
        get(&app, &writer, "/api/v1/knowledge/documents?q=%20%20")
            .await
            .status(),
        StatusCode::OK
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn search_cursors_are_filter_bound_stable_and_recheck_grants(pool: PgPool) {
    let app = application(pool.clone());
    register(&app, "owner@example.com").await;
    let writer = register(&app, "writer@example.com").await;
    let other = register(&app, "other@example.com").await;
    for title in ["note A", "note B", "other title", "note C"] {
        assert_eq!(
            create(&app, &writer, title, "body").await.status(),
            StatusCode::CREATED
        );
    }
    let page = data(get(&app, &writer, "/api/v1/knowledge/documents?q=note&limit=2").await).await;
    assert_eq!(page["data"][0]["title"], "note C");
    assert_eq!(page["data"][1]["title"], "note B");
    let cursor = page["next_cursor"].as_str().unwrap();
    let path = format!("/api/v1/knowledge/documents?q=note&cursor={cursor}");
    assert_eq!(
        get(
            &app,
            &writer,
            &format!("/api/v1/knowledge/documents?q=other&cursor={cursor}")
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        create(&app, &writer, "note D", "newer").await.status(),
        StatusCode::CREATED
    );
    let next = data(get(&app, &writer, &path).await).await;
    assert_eq!(next["data"].as_array().unwrap().len(), 1);
    assert_eq!(next["data"][0]["title"], "note A");
    assert_eq!(next["has_more"], false);
    let hidden = data(get(&app, &other, "/api/v1/knowledge/documents?q=note").await).await;
    assert_eq!(
        hidden,
        json!({"data":[],"next_cursor":null,"has_more":false})
    );
    // Authorization administration is delivered by T07; revoke via fixture setup here.
    sqlx::query("DELETE FROM knowledge.grants")
        .execute(&pool)
        .await
        .unwrap();
    let revoked = data(get(&app, &writer, &path).await).await;
    assert_eq!(
        revoked,
        json!({"data":[],"next_cursor":null,"has_more":false})
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn title_search_treats_wildcards_as_literal_text_and_omits_bodies(pool: PgPool) {
    let app = application(pool);
    let writer = register(&app, "writer@example.com").await;
    for title in [
        "Release 100%_done\\notes",
        "Release 100XXdone-notes",
        "Other",
    ] {
        assert_eq!(
            create(&app, &writer, title, "private body").await.status(),
            StatusCode::CREATED
        );
    }
    let response = get(
        &app,
        &writer,
        "/api/v1/knowledge/documents?q=100%25_done%5Cnotes",
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let page = data(response).await;
    assert_eq!(page["data"].as_array().unwrap().len(), 1);
    assert_eq!(page["data"][0]["title"], "Release 100%_done\\notes");
    assert!(page["data"][0].get("markdown").is_none());
    assert_eq!(page["has_more"], false);
    let insensitive = data(get(&app, &writer, "/api/v1/knowledge/documents?q=release").await).await;
    assert_eq!(insensitive["data"].as_array().unwrap().len(), 2);
}

#[sqlx::test(migrations = "../../migrations")]
async fn personal_document_list_starts_empty_and_returns_summaries_with_bound_cursors(
    pool: PgPool,
) {
    let app = application(pool);
    let writer = register(&app, "writer@example.com").await;
    let empty = get(&app, &writer, "/api/v1/knowledge/documents").await;
    assert_eq!(empty.status(), StatusCode::OK);
    assert_eq!(
        data(empty).await,
        json!({"data":[],"next_cursor":null,"has_more":false})
    );
    for title in ["A", "B", "C"] {
        assert_eq!(
            create(&app, &writer, title, "正文不进入列表")
                .await
                .status(),
            StatusCode::CREATED
        );
    }
    let page = data(get(&app, &writer, "/api/v1/knowledge/documents?limit=2").await).await;
    assert_eq!(page["data"].as_array().unwrap().len(), 2);
    assert_eq!(page["has_more"], true);
    assert!(!page.to_string().contains("正文不进入列表"));
    let cursor = page["next_cursor"].as_str().unwrap();
    let next = data(
        get(
            &app,
            &writer,
            &format!("/api/v1/knowledge/documents?limit=2&cursor={cursor}"),
        )
        .await,
    )
    .await;
    assert_eq!(next["data"].as_array().unwrap().len(), 1);
    assert_eq!(next["has_more"], false);
    let other = register(&app, "other@example.com").await;
    assert_eq!(
        get(
            &app,
            &other,
            &format!("/api/v1/knowledge/documents?cursor={cursor}")
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
}
