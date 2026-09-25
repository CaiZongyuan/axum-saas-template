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
pub const FIELDS: &[Setting] = &[DATABASE, LISTENER, LOG_FILTER, MIGRATION_TIMEOUT];

pub struct Settings {
    pub bind: SocketAddr,
    pub database: PgConnectOptions,
    pub log_filter: EnvFilter,
    pub migration_timeout: Duration,
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
        Ok(Self {
            bind,
            database,
            log_filter,
            migration_timeout: Duration::from_secs(seconds),
        })
    }
}
