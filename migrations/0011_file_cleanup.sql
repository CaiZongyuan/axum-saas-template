ALTER TABLE saas_core.files ADD COLUMN cleanup_job_id uuid REFERENCES saas_core.jobs(id);
CREATE TABLE saas_core.object_cleanup (
    bucket text NOT NULL,
    object_key text NOT NULL,
    file_id uuid NOT NULL REFERENCES saas_core.files(id),
    candidate_id uuid REFERENCES saas_core.file_candidates(id),
    first_deleted_at timestamptz,
    last_checked_at timestamptz,
    next_probe_at timestamptz,
    last_error text,
    PRIMARY KEY (bucket, object_key)
);
CREATE INDEX object_cleanup_file ON saas_core.object_cleanup(file_id, first_deleted_at);
CREATE INDEX object_cleanup_probe ON saas_core.object_cleanup(next_probe_at) WHERE first_deleted_at IS NOT NULL;
ALTER TABLE saas_core.files ADD COLUMN next_cleanup_check_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX files_cleanup_check ON saas_core.files(next_cleanup_check_at, id);
CREATE TABLE saas_core.file_cleanup_control (
    id smallint PRIMARY KEY CHECK (id = 1),
    rescan_job_id uuid REFERENCES saas_core.jobs(id)
);
INSERT INTO saas_core.file_cleanup_control (id) VALUES (1);
