-- 015_correlation_ids.sql — Prompt 24, Deliverable 2.
--
-- Numbered 015, not the prompt's own illustrative "014_correlation_ids.sql"
-- — 014 was already taken by 014_scenario_runs.sql (Prompt 21), found by
-- reading the actual migrations directory rather than assuming the
-- prompt's own numbering matches the repo's current state.
--
-- request_id is nullable everywhere: not every row originates from a live
-- HTTP request. provisioning_jobs and approval_requests are always created
-- from an inbound request, so those are the ones a real correlation chain
-- needs. evidence rows split: origin='approval' rows are approval-flow
-- byproducts and can carry the approval's request_id; origin='audit-log'
-- rows are ingested asynchronously from Vault's own audit log, out of band
-- from any Arcanium request — those legitimately have no request_id, and
-- this migration does not pretend otherwise by backfilling one.

ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE evidence          ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_request_id ON provisioning_jobs(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_request_id ON approval_requests(request_id);
CREATE INDEX IF NOT EXISTS idx_evidence_request_id           ON evidence(request_id);

DO $$ BEGIN
  EXECUTE 'ALTER TABLE provisioning_jobs OWNER TO arcanium';
  EXECUTE 'ALTER TABLE approval_requests OWNER TO arcanium';
  EXECUTE 'ALTER TABLE evidence OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
