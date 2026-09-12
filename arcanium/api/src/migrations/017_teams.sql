-- 017_teams.sql — Prompt 27, Deliverable 2: Control-Plane Multi-Tenancy.
--
-- The link from a scoped OIDC group ("arcanium-<role>:team:<name>") to
-- concrete supplier records. A team with supplier_ids = NULL covers every
-- supplier (used for an estate-wide-read audit team scoped by team, not by
-- tenant) — distinct from an empty array, which would cover none.

CREATE TABLE teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,       -- matches the team name in the OIDC group, e.g. 'platform'
  description   TEXT,
  supplier_ids  UUID[],                     -- NULL = all suppliers; '{}' = none yet assigned
  environments  TEXT[],                     -- NULL = all environments this team may act in
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  EXECUTE 'ALTER TABLE teams OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
