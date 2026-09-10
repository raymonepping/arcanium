-- 009_evidence.sql — Prompt 15.3
-- First-class evidence trail. Governance events (approvals) + ingested workload
-- crypto operations from the Vault audit log — one place to answer "what
-- happened, who, through which path, against which tenant, what outcome".
-- Metadata only: never request/response bodies, never secret material.

CREATE TABLE IF NOT EXISTS evidence (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ts           TIMESTAMPTZ NOT NULL,
  actor        TEXT,
  source       TEXT        NOT NULL DEFAULT 'local' CHECK (source IN ('manual','local','external')),
  operation    TEXT        NOT NULL,           -- encrypt|decrypt|sign|verify|rotate|issue|...
  resource_type TEXT,                          -- key|certificate|namespace|...
  resource_id  TEXT,
  namespace    TEXT,
  supplier_id  UUID        REFERENCES suppliers(id) ON DELETE SET NULL,
  outcome      TEXT        NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok','denied','error')),
  origin       TEXT        NOT NULL DEFAULT 'audit-log' CHECK (origin IN ('audit-log','approval')),
  dedupe_key   TEXT        UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_ts        ON evidence(ts DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_operation ON evidence(operation);
CREATE INDEX IF NOT EXISTS idx_evidence_supplier  ON evidence(supplier_id);

-- Byte offset into the audit log we've already ingested (per file path).
CREATE TABLE IF NOT EXISTS ingest_cursor (
  path    TEXT PRIMARY KEY,
  offset_bytes BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  EXECUTE 'ALTER TABLE evidence OWNER TO arcanium';
  EXECUTE 'ALTER TABLE ingest_cursor OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
