//! Optional text cache. PostgreSQL callers retain ownership of authorization and versions.
use crate::config::ConfigError;
use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{sync::Semaphore, time::Instant};

#[derive(Clone)]
pub struct CacheSettings {
    pub url: String,
    pub prefix: String,
    pub ttl_secs: u32,
    pub budget: Duration,
}
impl Default for CacheSettings {
    fn default() -> Self {
        Self {
            url: "redis://127.0.0.1:6379/".into(),
            prefix: "saas".into(),
            ttl_secs: 60,
            budget: Duration::from_millis(100),
        }
    }
}
#[derive(Default)]
struct Counters {
    hits: AtomicU64,
    misses: AtomicU64,
    fallbacks: AtomicU64,
    writes: AtomicU64,
    write_failures: AtomicU64,
    invalidations: AtomicU64,
    invalidation_failures: AtomicU64,
}
pub struct CacheSnapshot {
    pub enabled: bool,
    pub hits: u64,
    pub misses: u64,
    pub fallbacks: u64,
    pub writes: u64,
    pub write_failures: u64,
    pub invalidations: u64,
    pub invalidation_failures: u64,
}
#[derive(Debug)]
pub struct CacheUnavailable;
pub enum Lookup {
    Hit(String),
    Miss,
    Unavailable,
    Disabled,
}
struct Inner {
    client: Option<redis::Client>,
    settings: CacheSettings,
    slots: Semaphore,
    counters: Counters,
}
#[derive(Clone)]
pub struct Cache(Arc<Inner>);
impl Default for Cache {
    fn default() -> Self {
        Self::disabled()
    }
}
impl Cache {
    pub fn disabled() -> Self {
        Self(Arc::new(Inner {
            client: None,
            settings: Default::default(),
            slots: Semaphore::new(16),
            counters: Default::default(),
        }))
    }
    pub fn new(settings: CacheSettings) -> Result<Self, ConfigError> {
        let url = url::Url::parse(&settings.url).map_err(|_| ConfigError("REDIS_URL"))?;
        if url.scheme() != "redis" || url.host_str().is_none() || url.fragment().is_some() {
            return Err(ConfigError("REDIS_URL"));
        }
        if settings.prefix.is_empty()
            || settings.prefix.len() > 100
            || !settings
                .prefix
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b":-_".contains(&c))
        {
            return Err(ConfigError("CACHE_PREFIX"));
        }
        if !(1..=3600).contains(&settings.ttl_secs) {
            return Err(ConfigError("CACHE_TTL_SECS"));
        }
        if settings.budget < Duration::from_millis(1) || settings.budget > Duration::from_secs(1) {
            return Err(ConfigError("CACHE_BUDGET_MS"));
        }
        let client =
            redis::Client::open(settings.url.as_str()).map_err(|_| ConfigError("REDIS_URL"))?;
        Ok(Self(Arc::new(Inner {
            client: Some(client),
            settings,
            slots: Semaphore::new(16),
            counters: Default::default(),
        })))
    }
    pub fn deadline(&self) -> Instant {
        Instant::now() + self.0.settings.budget
    }
    pub fn snapshot(&self) -> CacheSnapshot {
        let c = &self.0.counters;
        CacheSnapshot {
            enabled: self.0.client.is_some(),
            hits: c.hits.load(Ordering::Relaxed),
            misses: c.misses.load(Ordering::Relaxed),
            fallbacks: c.fallbacks.load(Ordering::Relaxed),
            writes: c.writes.load(Ordering::Relaxed),
            write_failures: c.write_failures.load(Ordering::Relaxed),
            invalidations: c.invalidations.load(Ordering::Relaxed),
            invalidation_failures: c.invalidation_failures.load(Ordering::Relaxed),
        }
    }
    fn key(&self, key: &str) -> Result<String, CacheUnavailable> {
        if key.is_empty() || key.len() > 512 || key.contains('\0') {
            return Err(CacheUnavailable);
        }
        Ok(format!("{}:{key}", self.0.settings.prefix))
    }
    async fn command<T: redis::FromRedisValue>(
        &self,
        command: &redis::Cmd,
        deadline: Instant,
    ) -> Result<T, CacheUnavailable> {
        let client = self.0.client.as_ref().ok_or(CacheUnavailable)?;
        let _permit = self.0.slots.try_acquire().map_err(|_| CacheUnavailable)?;
        if Instant::now() >= deadline {
            return Err(CacheUnavailable);
        }
        tokio::time::timeout_at(deadline, async {
            let config = redis::AsyncConnectionConfig::new()
                .set_connection_timeout(Some(self.0.settings.budget))
                .set_response_timeout(Some(self.0.settings.budget))
                .set_concurrency_limit(1)
                .set_pipeline_buffer_size(1);
            // The unique connection owner is dropped on success, error, cancellation or timeout.
            let mut connection = client
                .get_multiplexed_async_connection_with_config(&config)
                .await
                .map_err(|_| CacheUnavailable)?;
            command
                .query_async(&mut connection)
                .await
                .map_err(|_| CacheUnavailable)
        })
        .await
        .map_err(|_| CacheUnavailable)?
    }
    pub async fn get(&self, key: &str, deadline: Instant) -> Lookup {
        if self.0.client.is_none() {
            return Lookup::Disabled;
        }
        let result = async {
            self.command::<Option<String>>(redis::cmd("GET").arg(self.key(key)?), deadline)
                .await
        }
        .await;
        match result {
            Ok(Some(value)) if value.len() <= 1024 * 1024 => {
                self.0.counters.hits.fetch_add(1, Ordering::Relaxed);
                Lookup::Hit(value)
            }
            Ok(None) => {
                self.0.counters.misses.fetch_add(1, Ordering::Relaxed);
                Lookup::Miss
            }
            _ => {
                self.0.counters.fallbacks.fetch_add(1, Ordering::Relaxed);
                Lookup::Unavailable
            }
        }
    }
    pub async fn put(
        &self,
        key: &str,
        value: &str,
        deadline: Instant,
    ) -> Result<(), CacheUnavailable> {
        let result = async {
            if value.len() > 1024 * 1024 {
                return Err(CacheUnavailable);
            }
            self.command::<()>(
                redis::cmd("SET")
                    .arg(self.key(key)?)
                    .arg(value)
                    .arg("EX")
                    .arg(self.0.settings.ttl_secs),
                deadline,
            )
            .await
        }
        .await;
        if result.is_ok() {
            self.0.counters.writes.fetch_add(1, Ordering::Relaxed);
        } else {
            self.0
                .counters
                .write_failures
                .fetch_add(1, Ordering::Relaxed);
        }
        result
    }
    pub async fn remove(&self, key: &str, deadline: Instant) -> Result<(), CacheUnavailable> {
        if self.0.client.is_none() {
            return Ok(());
        }
        let result = async {
            self.command::<i64>(redis::cmd("DEL").arg(self.key(key)?), deadline)
                .await
        }
        .await;
        if result.is_ok() {
            self.0
                .counters
                .invalidations
                .fetch_add(1, Ordering::Relaxed);
        } else {
            self.0
                .counters
                .invalidation_failures
                .fetch_add(1, Ordering::Relaxed);
        }
        result.map(|_| ())
    }
}

pub const FIELDS: &[crate::config::Setting] = &[
    crate::config::Setting {
        name: "REDIS_URL",
        default: None,
        secret: true,
        description: "Optional redis:// connection URL. Unset disables caching; credentials are never logged.",
    },
    crate::config::Setting {
        name: "CACHE_PREFIX",
        default: Some("saas"),
        secret: false,
        description: "Deployment cache namespace (1..100 ASCII letters, digits, colon, dash or underscore).",
    },
    crate::config::Setting {
        name: "CACHE_TTL_SECS",
        default: Some("60"),
        secret: false,
        description: "Text cache TTL in seconds (1..3600). PostgreSQL remains the authorization/version source.",
    },
    crate::config::Setting {
        name: "CACHE_BUDGET_MS",
        default: Some("100"),
        secret: false,
        description: "Total optional Redis budget per read, including lookup/fill (1..1000 milliseconds).",
    },
];
impl Cache {
    pub fn from_env() -> Result<Self, ConfigError> {
        let url = match std::env::var("REDIS_URL") {
            Ok(url) if !url.trim().is_empty() => url,
            Ok(_) | Err(std::env::VarError::NotPresent) => return Ok(Self::disabled()),
            Err(_) => return Err(ConfigError("REDIS_URL")),
        };
        let prefix = std::env::var("CACHE_PREFIX").unwrap_or_else(|_| "saas".into());
        let ttl_secs = std::env::var("CACHE_TTL_SECS")
            .unwrap_or_else(|_| "60".into())
            .parse()
            .map_err(|_| ConfigError("CACHE_TTL_SECS"))?;
        let budget = Duration::from_millis(
            std::env::var("CACHE_BUDGET_MS")
                .unwrap_or_else(|_| "100".into())
                .parse()
                .map_err(|_| ConfigError("CACHE_BUDGET_MS"))?,
        );
        Self::new(CacheSettings {
            url,
            prefix,
            ttl_secs,
            budget,
        })
    }
}
