use super::{JobError, Lease, claim};
use sqlx::PgPool;
use std::{future::Future, sync::Arc, time::Duration};

#[derive(Clone)]
pub struct WorkerPolicy {
    pub lease_secs: u32,
    pub heartbeat_secs: u32,
    pub shutdown_secs: u32,
}
impl Default for WorkerPolicy {
    fn default() -> Self {
        Self {
            lease_secs: 60,
            heartbeat_secs: 20,
            shutdown_secs: 10,
        }
    }
}

pub const FIELDS: &[saas_platform::config::Setting] = &[
    saas_platform::config::Setting {
        name: "WORKER_BIND",
        default: Some("127.0.0.1:3001"),
        secret: false,
        description: "Worker health listener IP address and port.",
    },
    saas_platform::config::Setting {
        name: "JOB_LEASE_SECS",
        default: Some("60"),
        secret: false,
        description: "Job lease lifetime (5..3600 seconds).",
    },
    saas_platform::config::Setting {
        name: "JOB_HEARTBEAT_SECS",
        default: Some("20"),
        secret: false,
        description: "Lease renewal interval (1..half the lease seconds).",
    },
    saas_platform::config::Setting {
        name: "JOB_SHUTDOWN_SECS",
        default: Some("10"),
        secret: false,
        description: "Maximum active-work drain before process exit (1..60 seconds).",
    },
];
impl WorkerPolicy {
    pub fn from_env() -> Result<Self, saas_platform::config::ConfigError> {
        use saas_platform::config::bounded_u32;
        let lease_secs = bounded_u32(&FIELDS[1], 5, 3600)?;
        Ok(Self {
            lease_secs,
            heartbeat_secs: bounded_u32(&FIELDS[2], 1, lease_secs / 2)?,
            shutdown_secs: bounded_u32(&FIELDS[3], 1, 60)?,
        })
    }
}
pub fn worker_bind() -> Result<std::net::SocketAddr, saas_platform::config::ConfigError> {
    std::env::var("WORKER_BIND")
        .unwrap_or_else(|_| "127.0.0.1:3001".into())
        .parse()
        .map_err(|_| saas_platform::config::ConfigError("WORKER_BIND"))
}

#[async_trait::async_trait]
pub trait Handler: Send + Sync {
    fn kind(&self) -> &'static str;
    /// Publish business results and lease success in one transaction.
    async fn run(&self, lease: &Lease) -> Result<(), JobError>;
}

pub struct Worker {
    pool: PgPool,
    handlers: Vec<Arc<dyn Handler>>,
    identity: String,
    policy: WorkerPolicy,
    running: std::sync::atomic::AtomicBool,
}
impl Worker {
    pub fn new(pool: PgPool, handlers: Vec<Arc<dyn Handler>>, policy: WorkerPolicy) -> Self {
        Self {
            pool,
            handlers,
            identity: uuid::Uuid::now_v7().to_string(),
            policy,
            running: std::sync::atomic::AtomicBool::new(false),
        }
    }
    async fn next(&self) -> Result<Option<Lease>, sqlx::Error> {
        let kinds = self
            .handlers
            .iter()
            .map(|handler| handler.kind())
            .collect::<Vec<_>>();
        claim(&self.pool, &kinds, &self.identity, self.policy.lease_secs).await
    }
    pub async fn run_once(&self) -> Result<bool, sqlx::Error> {
        let Some(lease) = self.next().await? else {
            return Ok(false);
        };
        self.execute(&lease).await?;
        Ok(true)
    }
    async fn execute(&self, lease: &Lease) -> Result<(), sqlx::Error> {
        let Some(handler) = self
            .handlers
            .iter()
            .find(|handler| handler.kind() == lease.kind)
        else {
            return Ok(());
        };
        let result = {
            let work = handler.run(lease);
            tokio::pin!(work);
            let renewals = async {
                let mut heartbeat = tokio::time::interval(Duration::from_secs(u64::from(
                    self.policy.heartbeat_secs,
                )));
                heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                heartbeat.tick().await;
                loop {
                    heartbeat.tick().await;
                    match tokio::time::timeout(
                        Duration::from_secs(u64::from(self.policy.heartbeat_secs)),
                        lease.heartbeat(&self.pool, self.policy.lease_secs),
                    )
                    .await
                    {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => break Err(error),
                        Err(_) => break Err(JobError::Transient("jobs.heartbeat_timeout")),
                    }
                }
            };
            tokio::select! {
                biased;
                result = &mut work => result,
                result = renewals => result,
            }
        }; // Drop the handler and its transaction before persisting a failure.
        if let Err(error) = result {
            tokio::time::timeout(Duration::from_secs(3), lease.fail(&self.pool, &error))
                .await
                .map_err(|_| {
                    sqlx::Error::Io(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "job failure transition timed out",
                    ))
                })??;
        }
        Ok(())
    }

    /// Stop claiming first; an active attempt keeps its lease during the bounded drain.
    pub fn is_running(&self) -> bool {
        self.running.load(std::sync::atomic::Ordering::Acquire)
    }
    pub async fn run_until(&self, shutdown: impl Future<Output = ()>) {
        self.running
            .store(true, std::sync::atomic::Ordering::Release);
        struct Running<'a>(&'a std::sync::atomic::AtomicBool);
        impl Drop for Running<'_> {
            fn drop(&mut self) {
                self.0.store(false, std::sync::atomic::Ordering::Release);
            }
        }
        let _running = Running(&self.running);
        tokio::pin!(shutdown);
        loop {
            let lease = tokio::select! {
                biased;
                _ = &mut shutdown => return,
                result = self.next() => result,
            };
            match lease {
                Ok(Some(lease)) => {
                    let work = self.execute(&lease);
                    tokio::pin!(work);
                    tokio::select! {
                        _ = &mut shutdown => {
                            let _ = tokio::time::timeout(Duration::from_secs(u64::from(self.policy.shutdown_secs)), &mut work).await;
                            return;
                        }
                        result = &mut work => if result.is_err() { tracing::warn!("worker database operation failed"); },
                    }
                }
                other => {
                    if other.is_err() {
                        tracing::warn!("worker database operation failed");
                    }
                    tokio::select! { _ = &mut shutdown => return, _ = tokio::time::sleep(Duration::from_millis(250)) => {} }
                }
            }
        }
    }
}
