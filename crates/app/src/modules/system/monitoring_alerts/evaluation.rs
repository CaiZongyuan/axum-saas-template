use crate::modules::system::monitoring::{ErrorSample, Monitoring};
use crate::modules::{
    jobs,
    notifications::{self, Outcome},
    organization,
};
use chrono::{DateTime, Timelike, Utc};
use sqlx::PgPool;
use std::sync::Arc;

#[derive(sqlx::FromRow)]
struct Evaluation {
    id: String,
    enabled: bool,
    error_rate_percent: f64,
    duration_minutes: i32,
    state: String,
    last_evaluated_at: Option<DateTime<Utc>>,
    breach_started_at: Option<DateTime<Utc>>,
    last_sample_at: Option<DateTime<Utc>>,
    incident_id: Option<String>,
}

/// The caller supplies the observation clock and sample; both Worker and
/// integration tests use this interface over the same persistent transaction.
pub async fn evaluate_at(
    pool: &PgPool,
    sample: Option<ErrorSample>,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let now = now.with_nanosecond(0).expect("zero nanoseconds is valid");
    let mut tx = pool.begin().await?;
    // Membership locks precede the rule lock, matching administrative mutations.
    let recipients = organization::administrators_in(&mut tx).await?;
    let mut rule = sqlx::query_as::<_, Evaluation>("SELECT id::text, enabled, error_rate_percent, duration_minutes, state, last_evaluated_at, breach_started_at, last_sample_at, incident_id::text FROM saas_core.monitoring_alert_rule FOR UPDATE").fetch_one(&mut *tx).await?;
    if rule
        .last_evaluated_at
        .is_some_and(|previous| previous >= now)
    {
        return Ok(());
    }
    if !rule.enabled {
        rule.state = "disabled".into();
        rule.breach_started_at = None;
        rule.last_sample_at = None;
        rule.incident_id = None;
    } else {
        let valid = sample.filter(|sample| {
            sample.requests.is_finite()
                && sample.errors.is_finite()
                && sample.requests >= 100.0
                && sample.errors >= 0.0
                && sample.errors <= sample.requests
                && (-15..=180).contains(&(now - sample.sampled_at).num_seconds())
        });
        if let Some(sample) = valid {
            let sampled_at = sample
                .sampled_at
                .with_nanosecond(0)
                .expect("zero nanoseconds is valid");
            // Repeated scrapes of the same observation cannot advance a pending timer.
            if rule
                .last_sample_at
                .is_some_and(|previous| previous >= sampled_at)
            {
                return Ok(());
            }
            let error_rate = 100.0 * sample.errors / sample.requests;
            if error_rate > rule.error_rate_percent {
                if rule.incident_id.is_some() {
                    rule.state = "firing".into();
                } else {
                    let continuous = rule.state == "pending"
                        && rule.last_sample_at.is_some_and(|previous| {
                            (sampled_at - previous).num_seconds()
                                <= 3 * super::EVALUATION_INTERVAL_SECS as i64
                        });
                    let started = if continuous {
                        rule.breach_started_at.unwrap_or(now)
                    } else {
                        now
                    };
                    rule.breach_started_at = Some(started);
                    rule.state = "pending".into();
                    if (now - started).num_seconds() >= i64::from(rule.duration_minutes) * 60 {
                        let incident = uuid::Uuid::now_v7().to_string();
                        notifications::publish(
                            &mut tx,
                            &recipients,
                            &format!("monitoring:incident:{incident}"),
                            "monitoring.alert",
                            super::target(rule.id.clone()),
                            Outcome::Firing,
                        )
                        .await?;
                        rule.incident_id = Some(incident);
                        rule.state = "firing".into();
                    }
                }
            } else {
                if let Some(incident) = rule.incident_id.take() {
                    notifications::publish(
                        &mut tx,
                        &recipients,
                        &format!("monitoring:incident:{incident}"),
                        "monitoring.alert",
                        super::target(rule.id.clone()),
                        Outcome::Recovered,
                    )
                    .await?;
                }
                rule.breach_started_at = None;
                rule.state = "normal".into();
            }
            rule.last_sample_at = Some(sampled_at);
        } else {
            rule.state = "no_data".into();
            if rule.incident_id.is_none() {
                rule.breach_started_at = None;
            }
        }
    }
    sqlx::query("UPDATE saas_core.monitoring_alert_rule SET state = $1, last_evaluated_at = $2, breach_started_at = $3, last_sample_at = $4, incident_id = $5::uuid")
        .bind(rule.state).bind(now).bind(rule.breach_started_at).bind(rule.last_sample_at).bind(rule.incident_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

struct AlertEvaluation {
    pool: PgPool,
    monitoring: Monitoring,
}
pub fn maintenance(pool: PgPool, monitoring: Monitoring) -> Arc<dyn jobs::Maintenance> {
    Arc::new(AlertEvaluation { pool, monitoring })
}
#[async_trait::async_trait]
impl jobs::Maintenance for AlertEvaluation {
    fn name(&self) -> &'static str {
        "monitoring.alerts"
    }
    async fn schedule(&self) -> Result<(), jobs::JobError> {
        let enabled: bool =
            sqlx::query_scalar("SELECT enabled FROM saas_core.monitoring_alert_rule")
                .fetch_one(&self.pool)
                .await
                .map_err(|_| jobs::JobError::Transient("monitoring.unavailable"))?;
        if !enabled {
            return Ok(());
        }
        let sample = self.monitoring.error_sample().await;
        evaluate_at(&self.pool, sample, Utc::now())
            .await
            .map_err(|_| jobs::JobError::Transient("monitoring.unavailable"))
    }
}
