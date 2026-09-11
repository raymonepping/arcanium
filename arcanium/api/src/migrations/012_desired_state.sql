-- 012_desired_state.sql — Prompt 20: Desired State + Reconciliation.
--
-- Desired state lives in Arcanium's own domain model, not derived by
-- re-reading Vault (input/32/34) — otherwise there is nothing to diff
-- against. Observed state is always a live Vault read at reconciliation
-- time (see reconciliation/observe.js); it is never persisted as a
-- standalone "current truth" table, only as the result of a specific run.

CREATE TABLE desired_state (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id),
  key_name       TEXT NOT NULL,
  requirement    TEXT NOT NULL,   -- e.g. 'rotation_period'
  desired_value  JSONB NOT NULL,  -- e.g. {"days": 30}
  source         TEXT NOT NULL,   -- 'onboarding' | 'operator' | 'terraform'
  version        INTEGER NOT NULL DEFAULT 1,
  changed_by     TEXT NOT NULL,   -- subject from the Phase 18 session — who set THIS value
  changed_groups TEXT[] NOT NULL DEFAULT '{}', -- OIDC groups at time of THIS value —
                                   -- carried forward into desired_state_history when
                                   -- superseded (found necessary while implementing:
                                   -- history can only record the prior row's groups if
                                   -- the live row actually has somewhere to hold them).
  changed_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, key_name, requirement)
);

-- Every change to a live desired_state row is appended here first, so intent
-- history survives even though desired_state itself only holds the current
-- value (input/36: "who changed the intent from 30 to 90 days, when, why,
-- and under what authorization?" must be answerable).
CREATE TABLE desired_state_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desired_state_id UUID NOT NULL REFERENCES desired_state(id),
  version        INTEGER NOT NULL,
  desired_value  JSONB NOT NULL,
  changed_by     TEXT NOT NULL,
  changed_groups TEXT[] NOT NULL,   -- OIDC groups at time of change, from Phase 18 session
  changed_reason TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desired_state_id UUID NOT NULL REFERENCES desired_state(id),
  desired_state_version INTEGER NOT NULL,   -- which version of intent this run compared against
  observed_value JSONB,
  status         TEXT NOT NULL CHECK (status IN ('COMPLIANT','DRIFTED','UNKNOWN')),
  observed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail         TEXT
);

CREATE TABLE reconciliation_actions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES reconciliation_runs(id),
  action         TEXT NOT NULL CHECK (action IN ('reconcile','accept_exception')),
  actor          TEXT NOT NULL,       -- subject from Phase 18 session
  actor_groups   TEXT[] NOT NULL,
  result         TEXT NOT NULL,       -- 'applied' | 'failed' | 'denied'
  reason         TEXT,                -- required for accept_exception
  expires_at     TIMESTAMPTZ,         -- required for accept_exception (input/36 —
                                       -- an exception without an expiry becomes
                                       -- permanent furniture); NULL for reconcile
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reconciliation_runs_desired_state ON reconciliation_runs (desired_state_id, observed_at DESC);
CREATE INDEX idx_reconciliation_actions_run ON reconciliation_actions (run_id, created_at DESC);
CREATE INDEX idx_desired_state_history_state ON desired_state_history (desired_state_id, version DESC);

DO $$ BEGIN
  EXECUTE 'ALTER TABLE desired_state OWNER TO arcanium';
  EXECUTE 'ALTER TABLE desired_state_history OWNER TO arcanium';
  EXECUTE 'ALTER TABLE reconciliation_runs OWNER TO arcanium';
  EXECUTE 'ALTER TABLE reconciliation_actions OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
