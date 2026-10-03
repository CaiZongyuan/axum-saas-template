//! One deployment-wide rule. Monitoring failure never changes business readiness.
mod evaluation;
use crate::{
    http::{BoundedJson, RequestId, public_error},
    modules::{
        audit, identity,
        notifications::{self, NotificationTarget, Outcome},
        organization::{self, MemberRole},
    },
};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
pub use evaluation::{evaluate_at, maintenance};
pub const EVALUATION_INTERVAL_SECS: u64 = 30;
use saas_platform::config::AuthSettings;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{OpenApi, ToSchema};

const COLUMNS: &str = "id::text, version, enabled, error_rate_percent, duration_minutes, state, last_evaluated_at, breach_started_at";

#[derive(Clone, Serialize, ToSchema, sqlx::FromRow)]
pub struct MonitoringAlertRule {
    pub id: String,
    pub version: i64,
    pub enabled: bool,
    pub error_rate_percent: f64,
    pub duration_minutes: i32,
    pub state: String,
    pub last_evaluated_at: Option<DateTime<Utc>>,
    pub breach_started_at: Option<DateTime<Utc>>,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateMonitoringAlertRule {
    pub version: i64,
    pub enabled: bool,
    pub error_rate_percent: f64,
    pub duration_minutes: i32,
}
#[derive(Clone)]
struct Administration {
    pool: PgPool,
    auth: AuthSettings,
}
pub fn router(pool: PgPool, auth: AuthSettings) -> Router {
    Router::new()
        .route(
            "/api/v1/system/monitoring/alerts",
            get(get_rule).put(update_rule),
        )
        .route("/api/v1/system/monitoring/alerts/test", post(test_alert))
        .layer(DefaultBodyLimit::max(4096))
        .layer(middleware::map_response(
            |mut response: Response| async move {
                response
                    .headers_mut()
                    .insert("cache-control", HeaderValue::from_static("no-store"));
                response
            },
        ))
        .with_state(Administration { pool, auth })
}
#[derive(OpenApi)]
#[openapi(paths(get_rule, update_rule, test_alert))]
struct AlertApi;
pub fn openapi() -> utoipa::openapi::OpenApi {
    AlertApi::openapi()
}

enum Error {
    Forbidden,
    Invalid,
    Conflict,
    Unavailable,
}
impl From<sqlx::Error> for Error {
    fn from(_: sqlx::Error) -> Self {
        Self::Unavailable
    }
}
impl Error {
    fn response(self, id: RequestId) -> Response {
        match self {
            Self::Forbidden => public_error(
                StatusCode::FORBIDDEN,
                "monitoring.forbidden",
                "Only an active administrator can manage monitoring alerts",
                id,
            ),
            Self::Invalid => public_error(
                StatusCode::BAD_REQUEST,
                "monitoring.invalid_rule",
                "Use a positive error percentage up to 100 and a 1, 5 or 10 minute duration",
                id,
            ),
            Self::Conflict => public_error(
                StatusCode::CONFLICT,
                "monitoring.version_conflict",
                "The alert rule changed; reload it before saving",
                id,
            ),
            Self::Unavailable => public_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "monitoring.unavailable",
                "Monitoring alerts are temporarily unavailable",
                id,
            ),
        }
    }
}
async fn require_admin(connection: &mut sqlx::PgConnection, actor: &str) -> Result<(), Error> {
    if !matches!(
        organization::active_role_in(connection, actor).await?,
        Some(MemberRole::Owner | MemberRole::Admin)
    ) {
        return Err(Error::Forbidden);
    }
    Ok(())
}
async fn load(pool: &PgPool, actor: &str) -> Result<MonitoringAlertRule, Error> {
    let mut tx = pool.begin().await?;
    require_admin(&mut tx, actor).await?;
    let rule = sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM saas_core.monitoring_alert_rule"
    ))
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rule)
}
#[utoipa::path(get,path="/api/v1/system/monitoring/alerts",operation_id="getMonitoringAlertRule",tag="System",responses((status=200,body=MonitoringAlertRule),(status=401,body=crate::http::ApiErrorResponse),(status=403,body=crate::http::ApiErrorResponse),(status=503,body=crate::http::ApiErrorResponse)))]
async fn get_rule(
    State(state): State<Administration>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
) -> Response {
    let session =
        match identity::require_session(&state.pool, &state.auth, &headers, &id, false).await {
            Ok(session) => session,
            Err(response) => return response,
        };
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        load(&state.pool, &session.user.id),
    )
    .await
    {
        Ok(Ok(rule)) => Json(rule).into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Error::Unavailable.response(id),
    }
}

async fn update(
    pool: &PgPool,
    actor: &str,
    request_id: &str,
    input: UpdateMonitoringAlertRule,
) -> Result<MonitoringAlertRule, Error> {
    if input.version < 1
        || !input.error_rate_percent.is_finite()
        || input.error_rate_percent <= 0.0
        || input.error_rate_percent > 100.0
        || !matches!(input.duration_minutes, 1 | 5 | 10)
    {
        return Err(Error::Invalid);
    }
    let mut tx = pool.begin().await?;
    require_admin(&mut tx, actor).await?;
    let rule = sqlx::query_as::<_, MonitoringAlertRule>(&format!("UPDATE saas_core.monitoring_alert_rule SET version = version + 1, enabled = $2, error_rate_percent = $3, duration_minutes = $4, state = CASE WHEN $2 THEN 'no_data' ELSE 'disabled' END, last_evaluated_at = NULL, breach_started_at = NULL, last_sample_at = NULL, incident_id = NULL WHERE version = $1 RETURNING {COLUMNS}"))
        .bind(input.version).bind(input.enabled).bind(input.error_rate_percent).bind(input.duration_minutes).fetch_optional(&mut *tx).await?.ok_or(Error::Conflict)?;
    audit::append(
        &mut tx,
        audit::Event {
            actor_id: actor,
            action: "monitoring.alert_rule.updated",
            resource_type: "system.monitoring_alert_rule",
            resource_id: &rule.id,
            source: audit::Source::Request(request_id),
            subject_user_id: None,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(rule)
}
#[utoipa::path(put,path="/api/v1/system/monitoring/alerts",operation_id="updateMonitoringAlertRule",tag="System",request_body=UpdateMonitoringAlertRule,params(("x-csrf-token"=String,Header)),responses((status=200,body=MonitoringAlertRule),(status=400,body=crate::http::ApiErrorResponse),(status=401,body=crate::http::ApiErrorResponse),(status=403,body=crate::http::ApiErrorResponse),(status=409,body=crate::http::ApiErrorResponse),(status=413,body=crate::http::ApiErrorResponse),(status=503,body=crate::http::ApiErrorResponse)))]
async fn update_rule(
    State(state): State<Administration>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    BoundedJson(input): BoundedJson<UpdateMonitoringAlertRule>,
) -> Response {
    let session =
        match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await {
            Ok(session) => session,
            Err(response) => return response,
        };
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        update(&state.pool, &session.user.id, &id.0, input),
    )
    .await
    {
        Ok(Ok(rule)) => Json(rule).into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Error::Unavailable.response(id),
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MonitoringAlertTestRequest {}
#[derive(Serialize, ToSchema)]
pub struct MonitoringAlertTestResult {
    status: &'static str,
}
fn target(rule_id: String) -> NotificationTarget {
    NotificationTarget {
        kind: "core.monitoring.alert".into(),
        resource_id: rule_id,
        context: Default::default(),
    }
}
async fn create_test(pool: &PgPool, actor: &str, request_id: &str) -> Result<(), Error> {
    let mut tx = pool.begin().await?;
    require_admin(&mut tx, actor).await?;
    let rule_id: String =
        sqlx::query_scalar("SELECT id::text FROM saas_core.monitoring_alert_rule")
            .fetch_one(&mut *tx)
            .await?;
    let event_key = format!("monitoring:test:{}", uuid::Uuid::now_v7());
    notifications::publish(
        &mut tx,
        &[actor.to_owned()],
        &event_key,
        "monitoring.alert",
        target(rule_id.clone()),
        Outcome::Test,
    )
    .await?;
    audit::append(
        &mut tx,
        audit::Event {
            actor_id: actor,
            action: "monitoring.alert.tested",
            resource_type: "system.monitoring_alert_rule",
            resource_id: &rule_id,
            source: audit::Source::Request(request_id),
            subject_user_id: None,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
#[utoipa::path(post,path="/api/v1/system/monitoring/alerts/test",operation_id="testMonitoringAlert",tag="System",request_body=MonitoringAlertTestRequest,params(("x-csrf-token"=String,Header)),responses((status=201,body=MonitoringAlertTestResult),(status=400,body=crate::http::ApiErrorResponse),(status=401,body=crate::http::ApiErrorResponse),(status=403,body=crate::http::ApiErrorResponse),(status=503,body=crate::http::ApiErrorResponse)))]
async fn test_alert(
    State(state): State<Administration>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    BoundedJson(_input): BoundedJson<MonitoringAlertTestRequest>,
) -> Response {
    let session =
        match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await {
            Ok(session) => session,
            Err(response) => return response,
        };
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        create_test(&state.pool, &session.user.id, &id.0),
    )
    .await
    {
        Ok(Ok(())) => (
            StatusCode::CREATED,
            Json(MonitoringAlertTestResult { status: "created" }),
        )
            .into_response(),
        Ok(Err(error)) => error.response(id),
        Err(_) => Error::Unavailable.response(id),
    }
}
