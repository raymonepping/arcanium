-- 018_environment_tag.sql — Prompt 27, Deliverable 3: Control-Plane Multi-Tenancy.
--
-- Adds the environment dimension authorize()'s scoped grants (Deliverable 1)
-- check against. Defaulted to 'production' for existing rows — explicit,
-- not silent: every pre-existing application genuinely was production in
-- this stack (there was no environment concept before this migration), and
-- the DEFAULT applies to every future INSERT that omits the column too
-- (POST /api/v1/applications, Deliverable 3), matching the "explicitly set,
-- not silently defaulted without recording" rule — the value is recorded in
-- the row, not left NULL and assumed elsewhere.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production';

DO $$ BEGIN
  EXECUTE 'ALTER TABLE applications OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
