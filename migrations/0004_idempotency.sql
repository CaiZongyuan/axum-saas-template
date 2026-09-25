CREATE TABLE saas_core.idempotency_records (
    actor_id uuid NOT NULL REFERENCES saas_core.users(id),
    scope text NOT NULL,
    request_key text NOT NULL,
    fingerprint bytea NOT NULL,
    response jsonb,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    PRIMARY KEY (actor_id, scope, request_key)
);
CREATE INDEX idempotency_expiry ON saas_core.idempotency_records(expires_at);
