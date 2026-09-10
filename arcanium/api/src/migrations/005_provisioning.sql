-- 005_provisioning.sql — Prompt 14.2
-- Arcanium as a runtime orchestration layer: it now translates intent into Vault
-- configuration. Every such action is recorded as a provisioning job with its
-- ordered steps, so the UI can show progress and rollback.

CREATE TABLE IF NOT EXISTS provisioning_jobs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  TEXT        NOT NULL CHECK (target_type IN ('supplier','application','key')),
  target_id    TEXT        NOT NULL,
  target_name  TEXT,
  action       TEXT        NOT NULL CHECK (action IN ('provision','deprovision','rotate','rewrap','destroy')),
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','running','succeeded','failed','rolled_back')),
  steps        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  error        TEXT,
  requested_by TEXT        NOT NULL DEFAULT 'arcanium',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_status  ON provisioning_jobs(status);
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_target  ON provisioning_jobs(target_type, target_id);

CREATE TABLE IF NOT EXISTS lifecycle_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT        NOT NULL,
  resource_id   TEXT        NOT NULL,
  event         TEXT        NOT NULL,
  detail        JSONB,
  actor         TEXT        NOT NULL DEFAULT 'arcanium',
  source        TEXT        NOT NULL DEFAULT 'local' CHECK (source IN ('manual','local','external')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_resource ON lifecycle_events(resource_type, resource_id);

-- Optional crypto-profile hints Arcanium can set at provision time.
ALTER TABLE crypto_profiles ADD COLUMN IF NOT EXISTS custody TEXT;
ALTER TABLE crypto_profiles ADD COLUMN IF NOT EXISTS rotation_days INTEGER;

-- Dynamic Vault DB users differ per lease; hand ownership to the shared `arcanium`
-- role (every dynamic user is a member) so later migrations can ALTER these tables.
DO $$ BEGIN
  EXECUTE 'ALTER TABLE provisioning_jobs OWNER TO arcanium';
  EXECUTE 'ALTER TABLE lifecycle_events OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
