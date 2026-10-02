//! Bounded server-side access to deployment-provided monitoring services.
use crate::config::{ConfigError, Setting};
use serde::Deserialize;
use std::{collections::BTreeMap, time::Duration};

pub const FIELDS: &[Setting] = &[
    Setting {
        name: "MONITORING_PROMETHEUS_URL",
        default: None,
        secret: false,
        description: "Optional internal Prometheus HTTP(S) origin, queried only by the API and Worker. Empty disables metric queries.",
        description_zh: "可选的内部 Prometheus HTTP(S) 来源，仅供 API 和 Worker 查询；留空不查询指标。",
    },
    Setting {
        name: "MONITORING_WORKER_URL",
        default: None,
        secret: false,
        description: "Optional internal Worker HTTP(S) origin for a bounded readiness check.",
        description_zh: "可选的内部 Worker HTTP(S) 来源，用于有时限的就绪检查。",
    },
    Setting {
        name: "MONITORING_GRAFANA_URL",
        default: None,
        secret: false,
        description: "Optional browser-accessible Grafana URL. HTTPS except loopback development; no embedded credentials.",
        description_zh: "可选的浏览器可访问 Grafana URL。除回环开发外要求 HTTPS；不得嵌入凭据。",
    },
];
#[derive(Clone, Default)]
pub struct MonitoringSettings {
    pub prometheus_url: Option<String>,
    pub worker_url: Option<String>,
    pub grafana_url: Option<String>,
}
impl MonitoringSettings {
    pub fn from_env() -> Result<Self, ConfigError> {
        let optional = |name| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        };
        let settings = Self {
            prometheus_url: optional(FIELDS[0].name),
            worker_url: optional(FIELDS[1].name),
            grafana_url: optional(FIELDS[2].name),
        };
        settings.validate()?;
        Ok(settings)
    }
    fn validate(&self) -> Result<(), ConfigError> {
        for (value, setting, public) in [
            (&self.prometheus_url, &FIELDS[0], false),
            (&self.worker_url, &FIELDS[1], false),
            (&self.grafana_url, &FIELDS[2], true),
        ] {
            let Some(value) = value else { continue };
            let url = url::Url::parse(value).map_err(|_| ConfigError(setting.name))?;
            let loopback = match url.host() {
                Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
                Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
                Some(url::Host::Domain(host)) => host == "localhost",
                None => false,
            };
            if !matches!(url.scheme(), "http" | "https")
                || url.host().is_none()
                || url.port() == Some(0)
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || (!public && url.path() != "/")
                || (public && url.scheme() == "http" && !loopback)
            {
                return Err(ConfigError(setting.name));
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
pub struct QuerySeries {
    pub metric: BTreeMap<String, String>,
    pub value: Option<(f64, String)>,
    #[serde(default)]
    pub values: Vec<(f64, String)>,
}
#[derive(Deserialize)]
struct QueryData {
    #[serde(rename = "resultType")]
    result_type: String,
    result: Vec<QuerySeries>,
}
#[derive(Deserialize)]
struct QueryResponse {
    status: String,
    data: QueryData,
}

#[derive(Debug)]
pub struct MonitoringUnavailable;

#[derive(Clone)]
pub struct MonitoringClient {
    client: reqwest::Client,
    settings: MonitoringSettings,
}
impl Default for MonitoringClient {
    fn default() -> Self {
        Self::new(MonitoringSettings::default()).expect("default monitoring settings are valid")
    }
}
impl MonitoringClient {
    pub fn new(settings: MonitoringSettings) -> Result<Self, ConfigError> {
        settings.validate()?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(1500))
            .build()
            .map_err(|_| ConfigError("MONITORING_PROMETHEUS_URL"))?;
        Ok(Self { client, settings })
    }
    pub fn enabled(&self) -> bool {
        self.settings.prometheus_url.is_some()
    }
    pub fn grafana_url(&self) -> Option<&str> {
        self.settings.grafana_url.as_deref()
    }
    pub async fn worker_status(&self) -> &'static str {
        let Some(base) = &self.settings.worker_url else {
            return "unconfigured";
        };
        match self
            .client
            .get(format!("{}/health/ready", base.trim_end_matches('/')))
            .send()
            .await
        {
            Ok(response) if response.status() == reqwest::StatusCode::OK => "ready",
            _ => "unavailable",
        }
    }
    /// Expressions are constructed by the application, never accepted from a browser.
    pub async fn query(
        &self,
        expression: &str,
        at: i64,
    ) -> Result<Vec<QuerySeries>, MonitoringUnavailable> {
        self.fetch(
            "query",
            "vector",
            &[("query", expression.to_owned()), ("time", at.to_string())],
        )
        .await
        .map_err(|_| MonitoringUnavailable)
    }
    pub async fn query_range(
        &self,
        expression: &str,
        start: i64,
        end: i64,
        step: u32,
    ) -> Result<Vec<QuerySeries>, MonitoringUnavailable> {
        self.fetch(
            "query_range",
            "matrix",
            &[
                ("query", expression.to_owned()),
                ("start", start.to_string()),
                ("end", end.to_string()),
                ("step", step.to_string()),
            ],
        )
        .await
        .map_err(|_| MonitoringUnavailable)
    }
    async fn fetch(
        &self,
        path: &str,
        expected: &str,
        parameters: &[(&str, String)],
    ) -> Result<Vec<QuerySeries>, ()> {
        let base = self.settings.prometheus_url.as_ref().ok_or(())?;
        let mut response = self
            .client
            .get(format!("{}/api/v1/{path}", base.trim_end_matches('/')))
            .query(parameters)
            .send()
            .await
            .map_err(|_| ())?
            .error_for_status()
            .map_err(|_| ())?;
        const MAX_BYTES: usize = 256 * 1024;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_BYTES as u64)
        {
            return Err(());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err(());
            }
            bytes.extend_from_slice(&chunk);
        }
        let response: QueryResponse = serde_json::from_slice(&bytes).map_err(|_| ())?;
        if response.status != "success"
            || response.data.result_type != expected
            || response.data.result.len() > 16
            || response
                .data
                .result
                .iter()
                .any(|series| series.values.len() > 121)
        {
            return Err(());
        }
        Ok(response.data.result)
    }
}
