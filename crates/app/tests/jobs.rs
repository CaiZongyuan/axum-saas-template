use saas_app::modules::jobs::{self, Handler, JobError, Lease, NewJob, Worker, WorkerPolicy};
use sqlx::PgPool;
use std::{sync::Arc, time::Duration};
use tokio::sync::Notify;

struct Publishing {
    pool: PgPool,
    entered: Arc<Notify>,
    release: Arc<Notify>,
}
#[async_trait::async_trait]
impl Handler for Publishing {
    fn kind(&self) -> &'static str {
        "test.publish"
    }
    async fn run(&self, lease: &Lease) -> Result<(), JobError> {
        let mut tx = self.pool.begin().await?;
        lease.lock_current(&mut tx).await?;
        self.entered.notify_one();
        self.release.notified().await;
        lease.succeed(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn a_heartbeat_waiting_on_publication_does_not_suspend_the_publisher(pool: PgPool) {
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let mut tx = pool.begin().await.unwrap();
    let id = jobs::enqueue(
        &mut tx,
        NewJob {
            kind: "test.publish",
            schema_version: 1,
            payload: serde_json::json!({}),
            correlation_id: "heartbeat-publication",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let worker = Worker::new(
        pool.clone(),
        vec![Arc::new(Publishing {
            pool: pool.clone(),
            entered: entered.clone(),
            release: release.clone(),
        })],
        WorkerPolicy {
            heartbeat_secs: 1,
            ..Default::default()
        },
    );
    let mut task = tokio::spawn(async move { worker.run_once().await });
    entered.notified().await;
    // Observe the real database lock wait instead of guessing when the heartbeat starts.
    tokio::time::timeout(Duration::from_secs(5),async {
        loop {
            let blocked: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE saas_core.jobs SET lease_expires_at%')").fetch_one(&pool).await.unwrap();
            if blocked {break;}
            tokio::task::yield_now().await;
        }
    }).await.expect("heartbeat reached the publication lock");
    release.notify_one();
    let finished = tokio::time::timeout(Duration::from_secs(2), &mut task).await;
    if finished.is_err() {
        task.abort();
        let _ = task.await;
    }
    assert!(
        finished.is_ok(),
        "the handler must keep progressing while renewal waits"
    );
    let mut connection = pool.acquire().await.unwrap();
    let status = jobs::statuses(&mut connection, &[id]).await.unwrap();
    assert_eq!(status[0].status, "succeeded");
}

#[sqlx::test(migrations = "../../migrations")]
async fn renewal_timeout_cancels_the_publisher_before_recording_failure(pool: PgPool) {
    let entered = Arc::new(Notify::new());
    let mut tx = pool.begin().await.unwrap();
    let id = jobs::enqueue(
        &mut tx,
        NewJob {
            kind: "test.publish",
            schema_version: 1,
            payload: serde_json::json!({}),
            correlation_id: "renewal-timeout",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let worker = Worker::new(
        pool.clone(),
        vec![Arc::new(Publishing {
            pool: pool.clone(),
            entered: entered.clone(),
            release: Arc::new(Notify::new()),
        })],
        WorkerPolicy {
            heartbeat_secs: 1,
            ..Default::default()
        },
    );
    let mut task = tokio::spawn(async move { worker.run_once().await });
    entered.notified().await;
    // The publisher deliberately keeps the lease row locked beyond the renewal deadline.
    let finished = tokio::time::timeout(Duration::from_secs(5), &mut task).await;
    if finished.is_err() {
        task.abort();
        let _ = task.await;
    }
    assert!(
        finished.is_ok(),
        "failure recording must not wait on the cancelled handler"
    );
    let mut connection = pool.acquire().await.unwrap();
    let status = jobs::statuses(&mut connection, &[id]).await.unwrap();
    assert_eq!(status[0].status, "retry_wait");
    assert_eq!(
        status[0].last_error.as_deref(),
        Some("jobs.heartbeat_timeout")
    );
}
