-- 019_service_accounts.sql — Prompt 28, Deliverable 1: machine-to-machine
-- identity. A service account is a named machine identity with an explicit
-- role set and tenant scope — the SAME `identity.roles`/`identity.tenantScopes`
-- shape authorize() already consumes for humans, fed from a different
-- source. No parallel authorization path.

CREATE TABLE service_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL UNIQUE,
  description    TEXT,
  roles          TEXT[] NOT NULL,          -- same role names as MATRIX in authorize.js
  tenant_scopes  TEXT[],                   -- NULL = estate-wide; populated = scoped
  created_by     TEXT NOT NULL,            -- Arcanium username of the human who issued it
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  revoked_by     TEXT
);

CREATE TABLE service_account_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_account_id  UUID NOT NULL REFERENCES service_accounts(id),
  token_hash          TEXT NOT NULL UNIQUE,  -- SHA-256 of the issued token — NEVER the token itself
  description         TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,  -- tokens must have an expiry; no open-ended credentials
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ
);

CREATE INDEX idx_service_account_tokens_sa ON service_account_tokens (service_account_id);

DO $$ BEGIN
  EXECUTE 'ALTER TABLE service_accounts OWNER TO arcanium';
  EXECUTE 'ALTER TABLE service_account_tokens OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
