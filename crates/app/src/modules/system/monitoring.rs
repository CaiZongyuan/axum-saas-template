use crate::{
    http::{ApiQuery, RequestId, public_error},
    modules::{identity, jobs, organization::MemberRole},
};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{DateTime, Utc};
use saas_platform::config::AuthSettings;
use saas_platform::monitoring::{MonitoringClient, MonitoringSettings, QuerySeries};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::BTreeMap;
use utoipa::{IntoParams, OpenApi, ToSchema};

#[derive(Clone, Default)]
pub struct Monitoring(MonitoringClient);

const FRESHNESS_SECONDS: i64 = 180;
const TRAFFIC: &str = r#"job="saas-api",route!~"/health/.*|/api/v1/system/monitoring.*""#;
const HEARTBEAT: &str = r#"max(saas_telemetry_heartbeat_seconds{service="saas-api"})"#;

impl Monitoring {
    pub fn from_env() -> Result<Self, saas_platform::config::ConfigError> {
        Self::new(MonitoringSettings::from_env()?)
    }
    pub fn new(settings: MonitoringSettings) -> Result<Self, saas_platform::config::ConfigError> {
        MonitoringClient::new(settings).map(Self)
    }

    /// A fixed five-minute sample for alert evaluation. Missing or stale collection
    /// never becomes a successful zero-error evaluation.
    pub async fn error_sample(&self) -> Option<ErrorSample> {
        if !self.0.enabled() {
            return None;
        }
        let now = Utc::now();
        let rows = self
            .0
            .query(&totals_expression(5), now.timestamp())
            .await
            .ok()?;
        let values = scalar_values(rows).ok()?;
        let sampled_at = heartbeat(&values)?;
        if !fresh(sampled_at, now) {
            return None;
        }
        let (requests, errors) = counts(&values).ok()?;
        Some(ErrorSample {
            sampled_at,
            requests,
            errors,
        })
    }

    async fn metrics(
        &self,
        window: u32,
        now: DateTime<Utc>,
    ) -> (CollectionStatus, Option<HttpMetrics>) {
        let status = |state, last_sample_at| {
            (
                CollectionStatus {
                    state,
                    last_sample_at,
                },
                None,
            )
        };
        if !self.0.enabled() {
            return status("disabled", None);
        }
        let summary_expression = totals_expression(window);
        let history_expression = history_expression();
        let (totals, history) = tokio::join!(
            self.0.query(&summary_expression, now.timestamp()),
            self.0.query_range(
                &history_expression,
                now.timestamp() - i64::from(window) * 60,
                now.timestamp(),
                window
            ),
        );
        let Ok(values) = totals.map_err(|_| ()).and_then(scalar_values) else {
            return status("unavailable", None);
        };
        let Some(sampled_at) = heartbeat(&values) else {
            return status("waiting", None);
        };
        if !fresh(sampled_at, now) {
            return status("stale", Some(sampled_at));
        }
        let Ok(series) = history
            .map_err(|_| ())
            .and_then(|rows| history_points(rows, now.timestamp(), window))
        else {
            return status("unavailable", Some(sampled_at));
        };
        let Ok((requests, server_errors)) = counts(&values) else {
            return status("unavailable", Some(sampled_at));
        };
        let percentile = |name| {
            if requests > 0.0 {
                values
                    .get(name)
                    .copied()
                    .flatten()
                    .map(|seconds| seconds * 1000.0)
            } else {
                None
            }
        };
        (
            CollectionStatus {
                state: "collecting",
                last_sample_at: Some(sampled_at),
            },
            Some(HttpMetrics {
                requests,
                server_errors,
                error_rate_percent: (requests > 0.0).then(|| 100.0 * server_errors / requests),
                p50_ms: percentile("p50"),
                p95_ms: percentile("p95"),
                series,
            }),
        )
    }
}

fn named(expression: &str, name: &str) -> String {
    format!(r#"label_replace(({expression}), "monitoring_metric", "{name}", "", "")"#)
}
fn totals_expression(window: u32) -> String {
    [
        named(HEARTBEAT, "heartbeat"),
        named(&format!("sum(increase(saas_http_requests_total{{{TRAFFIC}}}[{window}m]))"), "requests"),
        named(&format!("sum(increase(saas_http_requests_total{{{TRAFFIC},status=\"5xx\"}}[{window}m]))"), "errors"),
        named(&format!("histogram_quantile(0.5, sum by(le)(increase(saas_http_duration_seconds_bucket{{{TRAFFIC}}}[{window}m])))"), "p50"),
        named(&format!("histogram_quantile(0.95, sum by(le)(increase(saas_http_duration_seconds_bucket{{{TRAFFIC}}}[{window}m])))"), "p95"),
    ].join(" or ")
}
fn history_expression() -> String {
    let requests = format!("sum(rate(saas_http_requests_total{{{TRAFFIC}}}[1m]))");
    let errors = format!(
        "100 * ((sum(rate(saas_http_requests_total{{{TRAFFIC},status=\"5xx\"}}[1m])) or vector(0)) / ({requests}))"
    );
    let p95 = format!(
        "histogram_quantile(0.95, sum by(le)(rate(saas_http_duration_seconds_bucket{{{TRAFFIC}}}[1m])))"
    );
    let all = [
        named(&requests, "requests"),
        named(&errors, "errors"),
        named(&p95, "p95"),
    ]
    .join(" or ");
    // Evaluate freshness at each historical instant as well as at the end of the window.
    format!(
        "({all}) and on() (({HEARTBEAT}) > time() - {FRESHNESS_SECONDS}) and on() (({HEARTBEAT}) < time() + 15)"
    )
}
fn numeric(value: &str) -> Result<Option<f64>, ()> {
    let value = value.parse::<f64>().map_err(|_| ())?;
    Ok(value.is_finite().then_some(value))
}
fn scalar_values(rows: Vec<QuerySeries>) -> Result<BTreeMap<String, Option<f64>>, ()> {
    let mut values = BTreeMap::new();
    for row in rows {
        let name = row.metric.get("monitoring_metric").ok_or(())?.clone();
        let (_, value) = row.value.ok_or(())?;
        if values.insert(name, numeric(&value)?).is_some() {
            return Err(());
        }
    }
    Ok(values)
}
fn heartbeat(values: &BTreeMap<String, Option<f64>>) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp(*values.get("heartbeat")?.as_ref()? as i64, 0)
}
fn counts(values: &BTreeMap<String, Option<f64>>) -> Result<(f64, f64), ()> {
    let count = |name| match values.get(name) {
        Some(Some(value)) if *value >= 0.0 => Ok(*value),
        None => Ok(0.0),
        _ => Err(()),
    };
    let requests = count("requests")?;
    let errors = count("errors")?;
    if errors > requests {
        return Err(());
    }
    Ok((requests, errors))
}
fn fresh(sample: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    (-15..=FRESHNESS_SECONDS).contains(&(now - sample).num_seconds())
}
fn history_points(
    rows: Vec<QuerySeries>,
    end: i64,
    window: u32,
) -> Result<Vec<HttpMetricPoint>, ()> {
    let mut points = BTreeMap::new();
    let start = end - i64::from(window) * 60;
    for offset in 0..=60 {
        let at = DateTime::from_timestamp(start + offset * i64::from(window), 0).ok_or(())?;
        points.insert(
            at,
            HttpMetricPoint {
                at,
                requests_per_second: None,
                error_rate_percent: None,
                p95_ms: None,
            },
        );
    }
    for row in rows {
        let name = row.metric.get("monitoring_metric").ok_or(())?;
        for (at, value) in row.values {
            if !at.is_finite() {
                return Err(());
            }
            let at = DateTime::from_timestamp(at as i64, 0).ok_or(())?;
            let value = numeric(&value)?;
            let point = points.get_mut(&at).ok_or(())?;
            match name.as_str() {
                "requests" => point.requests_per_second = value,
                "errors" => point.error_rate_percent = value,
                "p95" => point.p95_ms = value.map(|seconds| seconds * 1000.0),
                _ => return Err(()),
            }
        }
    }
    if points.len() > 121 {
        return Err(());
    }
    Ok(points.into_values().collect())
}

pub struct ErrorSample {
    pub sampled_at: DateTime<Utc>,
    pub requests: f64,
    pub errors: f64,
}
#[derive(Serialize, ToSchema)]
pub struct HttpMetricPoint {
    pub at: DateTime<Utc>,
    pub requests_per_second: Option<f64>,
    pub error_rate_percent: Option<f64>,
    pub p95_ms: Option<f64>,
}
#[derive(Serialize, ToSchema)]
pub struct HttpMetrics {
    pub requests: f64,
    pub server_errors: f64,
    pub error_rate_percent: Option<f64>,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub series: Vec<HttpMetricPoint>,
}
#[derive(Serialize, ToSchema)]
pub struct MonitoringServices {
    pub api: &'static str,
    pub database: &'static str,
    pub worker: &'static str,
}
#[derive(Serialize, ToSchema)]
pub struct CollectionStatus {
    pub state: &'static str,
    pub last_sample_at: Option<DateTime<Utc>>,
}
#[derive(Serialize, ToSchema)]
pub struct MonitoringSnapshot {
    pub checked_at: DateTime<Utc>,
    pub window_minutes: u32,
    pub services: MonitoringServices,
    pub collection: CollectionStatus,
    pub http: Option<HttpMetrics>,
    pub jobs: jobs::JobMonitoringSummary,
    pub grafana_url: Option<String>,
}
#[derive(Clone)]
struct Administration {
    pool: PgPool,
    auth: AuthSettings,
    monitoring: Monitoring,
}
pub fn router(pool: PgPool, auth: AuthSettings, monitoring: Monitoring) -> Router {
    Router::new()
        .route("/api/v1/system/monitoring", get(snapshot))
        .with_state(Administration {
            pool,
            auth,
            monitoring,
        })
}
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct Window {
    window_minutes: Option<u32>,
}
#[derive(OpenApi)]
#[openapi(paths(snapshot))]
struct MonitoringApi;
pub fn openapi() -> utoipa::openapi::OpenApi {
    MonitoringApi::openapi()
}
#[utoipa::path(get,path="/api/v1/system/monitoring",operation_id="getMonitoringSnapshot",tag="System",params(Window),responses((status=200,body=MonitoringSnapshot),(status=400,body=crate::http::ApiErrorResponse),(status=401,body=crate::http::ApiErrorResponse),(status=403,body=crate::http::ApiErrorResponse),(status=503,body=crate::http::ApiErrorResponse)))]
async fn snapshot(
    State(state): State<Administration>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    ApiQuery(query): ApiQuery<Window>,
) -> Response {
    if let Err(response) = authorize(&state, &headers, &id).await {
        return response;
    }
    let window_minutes = query.window_minutes.unwrap_or(15);
    if !matches!(window_minutes, 15 | 60) {
        return public_error(
            StatusCode::BAD_REQUEST,
            "monitoring.invalid_window",
            "Select a 15 or 60 minute window",
            id,
        );
    }
    let checked_at = Utc::now();
    let jobs = match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        jobs::monitoring_summary(
            &state.pool,
            checked_at - chrono::Duration::minutes(i64::from(window_minutes)),
        ),
    )
    .await
    {
        Ok(Ok(jobs)) => jobs,
        _ => {
            return public_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "monitoring.unavailable",
                "Monitoring is temporarily unavailable",
                id,
            );
        }
    };
    let ((collection, http), worker) = tokio::join!(
        state.monitoring.metrics(window_minutes, checked_at),
        state.monitoring.0.worker_status()
    );
    // External I/O must not let an in-flight request outlive a membership or session revocation.
    if let Err(response) = authorize(&state, &headers, &id).await {
        return response;
    }
    (
        [("cache-control", "no-store")],
        Json(MonitoringSnapshot {
            checked_at,
            window_minutes,
            services: MonitoringServices {
                api: "ready",
                database: "ready",
                worker,
            },
            collection,
            http,
            jobs,
            grafana_url: state.monitoring.0.grafana_url().map(str::to_owned),
        }),
    )
        .into_response()
}

async fn authorize(
    state: &Administration,
    headers: &HeaderMap,
    id: &RequestId,
) -> Result<(), Response> {
    let session = identity::require_session(&state.pool, &state.auth, headers, id, false).await?;
    if matches!(session.user.role, MemberRole::Owner | MemberRole::Admin) {
        Ok(())
    } else {
        Err(public_error(
            StatusCode::FORBIDDEN,
            "system.forbidden",
            "Only an administrator can inspect monitoring",
            id.clone(),
        ))
    }
}
