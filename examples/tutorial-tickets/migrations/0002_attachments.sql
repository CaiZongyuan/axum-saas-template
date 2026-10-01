-- region:attachment-schema
CREATE TABLE support.uploads (
    file_id uuid PRIMARY KEY REFERENCES saas_core.files (id),
    ticket_id uuid NOT NULL REFERENCES support.tickets (id),
    published boolean NOT NULL DEFAULT false
);
CREATE INDEX ticket_uploads ON support.uploads (ticket_id, file_id);
-- endregion:attachment-schema
