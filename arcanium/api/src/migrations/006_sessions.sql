-- 006_sessions.sql — Prompt 14.5
-- Server-side session store for Arcanium human authentication (Vault userpass).
-- The cookie holds only an opaque id; everything else lives here.

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT        PRIMARY KEY,          -- random 32-byte hex
  username    TEXT        NOT NULL,
  persona     TEXT        NOT NULL,
  namespaces  TEXT[]      NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Dynamic Vault DB users differ per lease; hand ownership to the shared `arcanium`
-- role (every dynamic user is a member) so later migrations can ALTER these tables.
DO $$ BEGIN
  EXECUTE 'ALTER TABLE sessions OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
