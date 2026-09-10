-- 008_integrations.sql — Prompt 15.4
-- Registry of external integration channels ("Externe Koppeling / Jubes" in the
-- Enigma diagram). Each is approval-gated or namespace-scoped — an external
-- party never holds a broad token.

CREATE TABLE IF NOT EXISTS integrations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  kind        TEXT        NOT NULL CHECK (kind IN ('approval-gated','kmip','webhook')),
  operation   TEXT,                          -- e.g. 'transit-encrypt', 'pki-issue'
  supplier_id UUID        REFERENCES suppliers(id) ON DELETE SET NULL,
  status      TEXT        NOT NULL DEFAULT 'declared'
                          CHECK (status IN ('declared','connected','degraded','retired')),
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  EXECUTE 'ALTER TABLE integrations OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;

-- Seed the channels the platform knows about. external-supplier is a running
-- workload (it will heartbeat → 'connected'); external-partner-pki is declared
-- (the workload is scaffolded, not yet deployed).
INSERT INTO integrations (name, kind, operation, supplier_id, status)
SELECT 'external-supplier', 'approval-gated', 'transit-encrypt',
       (SELECT id FROM suppliers WHERE name = 'pepsi' LIMIT 1), 'declared'
WHERE NOT EXISTS (SELECT 1 FROM integrations WHERE name = 'external-supplier');

INSERT INTO integrations (name, kind, operation, supplier_id, status)
SELECT 'external-partner-pki', 'approval-gated', 'pki-issue',
       (SELECT id FROM suppliers WHERE name = 'cocacola' LIMIT 1), 'declared'
WHERE NOT EXISTS (SELECT 1 FROM integrations WHERE name = 'external-partner-pki');
