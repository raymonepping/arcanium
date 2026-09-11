-- 014_scenario_runs.sql — Prompt 21.
--
-- NEG-AUTHZ-01 needs real evidence that the hostile negative-auth suite
-- "last passed" (prompts/21_evidence_model_v2.md Deliverable 3) — that
-- requires the suite's own result to be persisted somewhere Arcanium can
-- read it back from. Generic (not negative-auth-specific) so any hostile
-- scenario can record its own outcome the same way; found necessary while
-- implementing, not specified by name in the prompt.

CREATE TABLE scenario_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario    TEXT NOT NULL,          -- e.g. '11_security_foundation'
  passed      INTEGER NOT NULL,
  failed      INTEGER NOT NULL,
  unknown     INTEGER NOT NULL,
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_runs_scenario ON scenario_runs (scenario, ran_at DESC);

DO $$ BEGIN
  EXECUTE 'ALTER TABLE scenario_runs OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
