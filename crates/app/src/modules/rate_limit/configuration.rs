use super::{Clock, Limits, Policy, RateLimiter};
use saas_platform::{
    config::{ConfigError, Setting},
    rate_limit::CounterSettings,
};
use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
pub const FIELDS: &[Setting] = &[
    Setting {
        name: "RATE_LIMIT_ENABLED",
        default: Some("true"),
        secret: false,
        description: "Enable registration, authentication and general request policies.",
    },
    Setting {
        name: "RATE_LIMIT_WINDOW_SECS",
        default: Some("60"),
        secret: false,
        description: "Fixed-window duration shared by rate policies (1..3600).",
    },
    Setting {
        name: "RATE_LIMIT_REGISTRATION",
        default: Some("20"),
        secret: false,
        description: "Registration requests per TCP peer/window with Redis (1..1000000).",
    },
    Setting {
        name: "RATE_LIMIT_REGISTRATION_FALLBACK",
        default: Some("5"),
        secret: false,
        description: "Conservative local registration capacity (1..registration capacity).",
    },
    Setting {
        name: "RATE_LIMIT_AUTHENTICATION",
        default: Some("60"),
        secret: false,
        description: "Credential requests per TCP peer/window with Redis (1..1000000).",
    },
    Setting {
        name: "RATE_LIMIT_AUTHENTICATION_FALLBACK",
        default: Some("20"),
        secret: false,
        description: "Conservative local authentication capacity (1..authentication capacity).",
    },
    Setting {
        name: "RATE_LIMIT_RESOURCE",
        default: Some("600"),
        secret: false,
        description: "Other requests per TCP peer/window with Redis (1..1000000); health probes are excluded.",
    },
    Setting {
        name: "RATE_LIMIT_RESOURCE_FALLBACK",
        default: Some("120"),
        secret: false,
        description: "Conservative local resource capacity (1..resource capacity).",
    },
    Setting {
        name: "RATE_LIMIT_MAX_LOCAL_ENTRIES",
        default: Some("4096"),
        secret: false,
        description: "Maximum local peer/policy buckets (1..100000); overflow shares conservative policy windows.",
    },
    Setting {
        name: "RATE_LIMIT_PREFIX",
        default: Some("saas"),
        secret: false,
        description: "Redis limiter namespace, isolated from text cache keys.",
    },
    Setting {
        name: "RATE_LIMIT_BUDGET_MS",
        default: Some("50"),
        secret: false,
        description: "Absolute Redis counter operation deadline (1..1000 ms), then local fallback.",
    },
];
struct SystemClock {
    anchor: u64,
    started: Instant,
}
impl SystemClock {
    fn new() -> Self {
        Self {
            anchor: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(u128::from(u64::MAX)) as u64,
            started: Instant::now(),
        }
    }
}
impl Clock for SystemClock {
    fn now_millis(&self) -> u64 {
        self.anchor
            .saturating_add(self.started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64)
    }
}
impl RateLimiter {
    pub fn from_env() -> Result<Self, ConfigError> {
        let value = |name: &'static str| -> Result<String, ConfigError> {
            match std::env::var(name) {
                Ok(value) => Ok(value),
                Err(std::env::VarError::NotPresent) => Ok(FIELDS
                    .iter()
                    .find(|field| field.name == name)
                    .and_then(|field| field.default)
                    .expect("declared limiter setting")
                    .to_owned()),
                Err(_) => Err(ConfigError(name)),
            }
        };
        let number = |name| value(name)?.parse::<u32>().map_err(|_| ConfigError(name));
        let enabled = value("RATE_LIMIT_ENABLED")?
            .parse::<bool>()
            .map_err(|_| ConfigError("RATE_LIMIT_ENABLED"))?;
        if !enabled {
            return Ok(Self::default());
        }
        let limits = Limits {
            window_secs: number("RATE_LIMIT_WINDOW_SECS")?,
            max_local_entries: number("RATE_LIMIT_MAX_LOCAL_ENTRIES")? as usize,
            registration: Policy {
                limit: number("RATE_LIMIT_REGISTRATION")?,
                fallback_limit: number("RATE_LIMIT_REGISTRATION_FALLBACK")?,
            },
            authentication: Policy {
                limit: number("RATE_LIMIT_AUTHENTICATION")?,
                fallback_limit: number("RATE_LIMIT_AUTHENTICATION_FALLBACK")?,
            },
            resource: Policy {
                limit: number("RATE_LIMIT_RESOURCE")?,
                fallback_limit: number("RATE_LIMIT_RESOURCE_FALLBACK")?,
            },
        };
        let clock = Arc::new(SystemClock::new());
        match std::env::var("REDIS_URL") {
            Ok(url) if !url.trim().is_empty() => Self::redis(
                limits,
                clock,
                CounterSettings {
                    url,
                    prefix: value("RATE_LIMIT_PREFIX")?,
                    budget: Duration::from_millis(u64::from(number("RATE_LIMIT_BUDGET_MS")?)),
                },
            ),
            Ok(_) | Err(std::env::VarError::NotPresent) => Self::local(limits, clock),
            Err(_) => Err(ConfigError("REDIS_URL")),
        }
    }
}
