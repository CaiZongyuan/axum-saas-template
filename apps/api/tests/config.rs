use std::{
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn rejects_configuration(database_url: &str, bind: &str, field: &str) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_saas-api"))
        .env("DATABASE_URL", database_url)
        .env("APP_BIND", bind)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if child.try_wait().unwrap().is_some() {
            break;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("invalid {field} did not fail before serving");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    let logs = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(logs.contains(field));
    assert!(!logs.contains("should-never-appear-in-logs"));
}

#[test]
fn invalid_bind_configuration_fails_before_serving_and_redacts_credentials() {
    rejects_configuration(
        "postgres://user:should-never-appear-in-logs@127.0.0.1:9/missing",
        "not-an-address",
        "APP_BIND",
    );
}

#[test]
fn a_non_postgres_url_is_rejected_without_logging_its_credentials() {
    rejects_configuration(
        "http://user:should-never-appear-in-logs@127.0.0.1:9/missing",
        "127.0.0.1:0",
        "DATABASE_URL",
    );
}
