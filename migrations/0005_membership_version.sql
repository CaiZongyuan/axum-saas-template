ALTER TABLE saas_core.memberships ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
