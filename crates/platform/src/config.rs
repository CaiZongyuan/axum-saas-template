use serde::Serialize;
use sqlx::{ConnectOptions, postgres::PgConnectOptions};
use std::{net::SocketAddr, str::FromStr, time::Duration};
use tracing_subscriber::EnvFilter;

#[derive(Serialize)]
pub struct Setting {
    pub name: &'static str,
    pub default: Option<&'static str>,
    pub secret: bool,
    pub description: &'static str,
}

const DATABASE: Setting = Setting {
    name: "DATABASE_URL",
    default: None,
    secret: true,
    description: "PostgreSQL connection URL. Required; never logged.",
};
const LISTENER: Setting = Setting {
    name: "APP_BIND",
    default: Some("127.0.0.1:3000"),
    secret: false,
    description: "API listener IP address and port.",
};
const LOG_FILTER: Setting = Setting {
    name: "RUST_LOG",
    default: Some("info"),
    secret: false,
    description: "Structured log filter.",
};
const MIGRATION_TIMEOUT: Setting = Setting {
    name: "MIGRATION_TIMEOUT_SECS",
    default: Some("30"),
    secret: false,
    description: "Migration execution deadline in seconds (1..3600).",
};
const APP_ORIGIN: Setting = Setting {
    name: "APP_ORIGIN",
    default: Some("http://127.0.0.1:5173"),
    secret: false,
    description: "Trusted browser origin. HTTPS required except loopback development.",
};
const SESSION_ABSOLUTE: Setting = Setting {
    name: "SESSION_ABSOLUTE_SECS",
    default: Some("604800"),
    secret: false,
    description: "Absolute session lifetime in seconds (60..2592000).",
};
const SESSION_IDLE: Setting = Setting {
    name: "SESSION_IDLE_SECS",
    default: Some("86400"),
    secret: false,
    description: "Idle session lifetime in seconds (60..absolute lifetime).",
};
pub const FIELDS: &[Setting] = &[
    DATABASE,
    LISTENER,
    LOG_FILTER,
    MIGRATION_TIMEOUT,
    APP_ORIGIN,
    SESSION_ABSOLUTE,
    SESSION_IDLE,
];

#[derive(Clone)]
pub struct AuthSettings {
    pub origin: String,
    pub secure_cookie: bool,
    pub absolute_secs: u32,
    pub idle_secs: u32,
}

impl Default for AuthSettings {
    fn default() -> Self {
        Self {
            origin: "http://127.0.0.1:5173".into(),
            secure_cookie: false,
            absolute_secs: 604800,
            idle_secs: 86400,
        }
    }
}

pub struct Settings {
    pub bind: SocketAddr,
    pub database: PgConnectOptions,
    pub log_filter: EnvFilter,
    pub migration_timeout: Duration,
    pub auth: AuthSettings,
}

#[derive(Debug, thiserror::Error)]
#[error("Invalid or missing {0}; check the configuration reference")]
pub struct ConfigError(&'static str);

impl Settings {
    pub fn from_env() -> Result<Self, ConfigError> {
        let value = |setting: &Setting| {
            std::env::var(setting.name)
                .ok()
                .or_else(|| setting.default.map(str::to_owned))
                .filter(|value| !value.trim().is_empty())
                .ok_or(ConfigError(setting.name))
        };
        let database_url = value(&DATABASE)?;
        let scheme = database_url.split_once("://").map(|(scheme, _)| scheme);
        if !scheme.is_some_and(|scheme| {
            scheme.eq_ignore_ascii_case("postgres") || scheme.eq_ignore_ascii_case("postgresql")
        }) {
            return Err(ConfigError(DATABASE.name));
        }
        let database = PgConnectOptions::from_str(&database_url)
            .map_err(|_| ConfigError(DATABASE.name))?
            .disable_statement_logging();
        let bind = value(&LISTENER)?
            .parse()
            .map_err(|_| ConfigError(LISTENER.name))?;
        let log_filter =
            EnvFilter::try_new(value(&LOG_FILTER)?).map_err(|_| ConfigError(LOG_FILTER.name))?;
        let seconds = value(&MIGRATION_TIMEOUT)?
            .parse::<u64>()
            .map_err(|_| ConfigError(MIGRATION_TIMEOUT.name))?;
        if !(1..=3600).contains(&seconds) {
            return Err(ConfigError(MIGRATION_TIMEOUT.name));
        }
        let origin =
            url::Url::parse(&value(&APP_ORIGIN)?).map_err(|_| ConfigError(APP_ORIGIN.name))?;
        let local = matches!(origin.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if !(origin.scheme() == "https" || origin.scheme() == "http" && local)
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.host_str().is_none()
        {
            return Err(ConfigError(APP_ORIGIN.name));
        }
        let absolute_secs = value(&SESSION_ABSOLUTE)?
            .parse::<u32>()
            .map_err(|_| ConfigError(SESSION_ABSOLUTE.name))?;
        let idle_secs = value(&SESSION_IDLE)?
            .parse::<u32>()
            .map_err(|_| ConfigError(SESSION_IDLE.name))?;
        if !(60..=2592000).contains(&absolute_secs) {
            return Err(ConfigError(SESSION_ABSOLUTE.name));
        }
        if !(60..=absolute_secs).contains(&idle_secs) {
            return Err(ConfigError(SESSION_IDLE.name));
        }
        Ok(Self {
            bind,
            database,
            log_filter,
            migration_timeout: Duration::from_secs(seconds),
            auth: AuthSettings {
                origin: origin.origin().ascii_serialization(),
                secure_cookie: origin.scheme() == "https",
                absolute_secs,
                idle_secs,
            },
        })
    }
}
