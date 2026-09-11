-- 016_restore_drills.sql — Prompt 24, Deliverables 3 & 7.
--
-- One history table for both named drills (Drill A: Vault snapshot
-- restore; Drill B: PostgreSQL loss), distinguished by `component` —
-- not two separate tables, per the prompt's own instruction ("Drill A and
-- Deliverable 7's Drill B share one history table").

CREATE TABLE restore_drill_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component     TEXT NOT NULL CHECK (component IN ('vault', 'postgres')),
  started_at    TIMESTAMPTZ NOT NULL,
  completed_at  TIMESTAMPTZ,
  rto_seconds   NUMERIC,
  rpo_seconds   NUMERIC,
  verified      BOOLEAN NOT NULL DEFAULT false,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_restore_drill_results_component ON restore_drill_results (component, created_at DESC);

DO $$ BEGIN
  EXECUTE 'ALTER TABLE restore_drill_results OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
