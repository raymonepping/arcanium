-- 007_job_params.sql — Prompt 15.6
-- Store the request parameters on the job so a worker can execute a queued job
-- without the original HTTP context.

DO $$ BEGIN
  EXECUTE 'ALTER TABLE provisioning_jobs OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;

ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}'::jsonb;
