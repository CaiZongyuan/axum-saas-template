CREATE TABLE saas_core.password_resets (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES saas_core.users(id),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    job_id uuid NOT NULL UNIQUE REFERENCES saas_core.jobs(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    revoked_at timestamptz
);
CREATE INDEX password_resets_user ON saas_core.password_resets (user_id, created_at DESC);
CREATE INDEX password_resets_expiry ON saas_core.password_resets (expires_at, id);
CREATE TABLE saas_core.password_reset_mail (
    reset_id uuid PRIMARY KEY REFERENCES saas_core.password_resets(id),
    key_version integer NOT NULL CHECK (key_version > 0),
    nonce bytea NOT NULL CHECK (octet_length(nonce) = 24),
    ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 16 AND 8192)
);
