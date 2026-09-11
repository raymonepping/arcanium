-- 013_controls.sql — Prompt 21: Evidence Model v2.
--
-- Replaces the flat 5-dimension average (Prompt 17) with a gated control
-- model: every claim traces to a control record backed by real evidence
-- (a Vault read, a Prompt 20 reconciliation run, a Sentinel policy list, a
-- Phase 18 session/authz decision) — never inferred from row existence
-- alone (input/03 §8, input/32).

CREATE TABLE controls (
  id           TEXT PRIMARY KEY,          -- e.g. 'KML-ROT-01'
  requirement  TEXT NOT NULL,             -- human-readable requirement text
  mandatory    BOOLEAN NOT NULL DEFAULT false,
  dimension    TEXT NOT NULL              -- existing 5 dimensions, extendable
);

CREATE TABLE control_assessments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id     TEXT NOT NULL REFERENCES controls(id),
  scope          TEXT NOT NULL,           -- e.g. 'suppliers/pepsi/payments-api', or 'estate'
  status         TEXT NOT NULL CHECK (status IN ('PASS','FAIL','UNKNOWN','N/A')),
  desired_value  JSONB,
  observed_value JSONB,
  evidence_refs  JSONB NOT NULL,          -- {reconciliation_run_id, vault_path, sentinel_policy, ...}
  freshness_seconds INTEGER,              -- age of the underlying observation
  confidence     TEXT NOT NULL CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  assessed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_control_assessments_control ON control_assessments (control_id, assessed_at DESC);
CREATE INDEX idx_control_assessments_scope   ON control_assessments (scope, assessed_at DESC);

-- Seeded control catalogue — exactly the controls MANDATORY_CONTROLS_PER_LEVEL
-- (maturity/controls.js) needs for Levels 1-5. Widening the catalogue with
-- non-mandatory controls is a follow-on, not required to gate correctly.
INSERT INTO controls (id, requirement, mandatory, dimension) VALUES
  ('KEY-INV-01', 'A live cryptographic key inventory exists in Vault.', true, 'Key Lifecycle Hygiene'),
  ('TEN-ISO-01', 'Tenant Vault namespaces enforce a verified cross-tenant boundary.', true, 'Access Control Coverage'),
  ('ROT-POL-01', 'Production keys rotate per their declared desired-state policy (Prompt 20).', true, 'Key Lifecycle Hygiene'),
  ('AUD-01',     'Governance actions are source- and actor-attributed.', true, 'Audit Trail Completeness'),
  ('WLI-01',     'Provisioned applications hold a least-privilege workload AppRole.', true, 'Access Control Coverage'),
  ('NEG-AUTHZ-01','The hostile negative-authorization test suite last passed.', true, 'Access Control Coverage'),
  ('AUTO-01',    'Rotation-from-automation is enforced by a Sentinel EGP.', true, 'Automation Depth'),
  ('GOV-01',     'Four-eyes governance (Control Group approval) is actively exercised.', true, 'Governance Adoption')
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  EXECUTE 'ALTER TABLE controls OWNER TO arcanium';
  EXECUTE 'ALTER TABLE control_assessments OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
