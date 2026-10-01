-- region:export-schema
CREATE TABLE support.exports (
    id uuid PRIMARY KEY,
    ticket_id uuid NOT NULL REFERENCES support.tickets (id),
    requested_by uuid NOT NULL REFERENCES saas_core.users (id),
    credential jsonb NOT NULL CHECK (jsonb_typeof(credential) = 'object'),
    job_id uuid NOT NULL UNIQUE REFERENCES saas_core.jobs (id),
    snapshot jsonb,
    file_id uuid REFERENCES saas_core.files (id),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_exports_expiry ON support.exports (expires_at, id)
    WHERE snapshot IS NOT NULL OR file_id IS NOT NULL;
CREATE INDEX ticket_exports_active ON support.exports (ticket_id, id)
    WHERE snapshot IS NOT NULL OR file_id IS NOT NULL;
-- endregion:export-schema
