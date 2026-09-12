-- 021_offboarding.sql — Prompt 28, Deliverable 6: offboarding workflow.
--
-- Tombstone, never hard-delete: desired_state.archived_at marks a row as
-- done (its key was destroyed, or its destroy approval was resolved either
-- way) without ever removing the row — evidence/reconciliation history
-- must survive the application's own lifecycle (Deliverable 8's fitness
-- test checks for exactly this: no hard-DELETE of desired_state,
-- reconciliation_runs, evidence, or control_assessments).
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS offboarding_initiated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboarded_at            TIMESTAMPTZ;

ALTER TABLE desired_state
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

DO $$ BEGIN
  EXECUTE 'ALTER TABLE applications OWNER TO arcanium';
  EXECUTE 'ALTER TABLE desired_state OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
