use sqlx::{ConnectOptions, PgPool, migrate::Migrate};
use std::time::Duration;

#[sqlx::test(migrations = false)]
async fn a_competing_migration_cannot_hold_the_cli_indefinitely(pool: PgPool) {
    let mut connection = pool.acquire().await.unwrap();
    connection.lock().await.unwrap();
    let result = tokio::time::timeout(
        Duration::from_secs(3),
        tokio::process::Command::new(env!("CARGO_BIN_EXE_migrate"))
            .env(
                "DATABASE_URL",
                pool.connect_options().to_url_lossy().to_string(),
            )
            .env("MIGRATION_TIMEOUT_SECS", "1")
            .kill_on_drop(true)
            .output(),
    )
    .await;
    connection.unlock().await.unwrap();
    let output = result
        .expect("migration must honor its execution deadline")
        .unwrap();
    assert!(!output.status.success());
    let message = String::from_utf8_lossy(&output.stderr);
    assert!(message.contains("timed out"));
    assert!(!message.contains("test-only-password"));
}
