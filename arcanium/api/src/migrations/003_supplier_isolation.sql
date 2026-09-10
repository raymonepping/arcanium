-- 003_supplier_isolation.sql
-- Append-only migration: adds suppliers table and backfills columns
-- already absent from 001_init.sql and 002_approvals.sql.

-- Suppliers: one row per Vault Enterprise namespace tenant
CREATE TABLE IF NOT EXISTS suppliers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL UNIQUE,
  vault_namespace  TEXT        NOT NULL UNIQUE,
  sla_tier         TEXT        NOT NULL DEFAULT 'standard'
                               CHECK (sla_tier IN ('standard','premium')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add supplier_id FK to applications (nullable — root-level apps have no supplier)
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_applications_supplier
  ON applications(supplier_id);

-- Backfill approval_requests with source + supplier_id
-- (002_approvals.sql created the table without these columns)
ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'external'
    CHECK (source IN ('manual','local','external'));

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_approval_requests_supplier
  ON approval_requests(supplier_id);
