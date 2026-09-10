-- 010_platform_apps.sql — Prompt 17
-- Adds a category column to applications.
--   platform = Arcanium-owned infrastructure workload (root namespace, no supplier)
--   tenant   = supplier-scoped application (has supplier_id)
--   unscoped = registered but not yet classified (default — penalised by maturity scorer)

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'unscoped'
    CHECK (category IN ('platform', 'tenant', 'unscoped'));

-- Backfill: apps with a supplier_id are already tenant-scoped.
UPDATE applications SET category = 'tenant' WHERE supplier_id IS NOT NULL;

COMMENT ON COLUMN applications.category IS
  'platform = Arcanium infrastructure workload; tenant = supplier-scoped; unscoped = not yet classified';

DO $$ BEGIN
  EXECUTE 'ALTER TABLE applications OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
