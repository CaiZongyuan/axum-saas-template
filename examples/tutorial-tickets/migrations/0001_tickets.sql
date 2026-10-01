-- region:ticket-schema
CREATE SCHEMA support;
CREATE TABLE support.tickets (
    id uuid PRIMARY KEY,
    created_by uuid NOT NULL REFERENCES saas_core.users (id),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    description text NOT NULL CHECK (octet_length(description) <= 8192),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX tickets_owner_list ON support.tickets (created_by, id DESC)
    WHERE deleted_at IS NULL;
-- endregion:ticket-schema
