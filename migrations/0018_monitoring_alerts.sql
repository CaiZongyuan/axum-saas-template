CREATE TABLE saas_core.monitoring_alert_rule (
    id uuid PRIMARY KEY CHECK (id = '00000000-0000-0000-0000-000000000001'),
    version bigint NOT NULL DEFAULT 1,
    enabled boolean NOT NULL DEFAULT false,
    error_rate_percent double precision NOT NULL DEFAULT 1 CHECK (error_rate_percent > 0 AND error_rate_percent <= 100),
    duration_minutes integer NOT NULL DEFAULT 5 CHECK (duration_minutes IN (1, 5, 10)),
    state text NOT NULL DEFAULT 'disabled' CHECK (state IN ('disabled', 'no_data', 'normal', 'pending', 'firing')),
    last_evaluated_at timestamptz,
    breach_started_at timestamptz,
    last_sample_at timestamptz,
    incident_id uuid
);
INSERT INTO saas_core.monitoring_alert_rule (id) VALUES ('00000000-0000-0000-0000-000000000001');

ALTER TABLE saas_core.notifications DROP CONSTRAINT notifications_outcome_check;
ALTER TABLE saas_core.notifications ADD CONSTRAINT notifications_outcome_check
    CHECK (outcome IN ('succeeded', 'failed', 'firing', 'recovered', 'test'));
