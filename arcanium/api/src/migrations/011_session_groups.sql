-- 011_session_groups.sql — Prompt 18
-- OIDC replaces Vault-userpass as the human AuthN mechanism. A session now
-- carries the OIDC group claims it was created from, so roles and tenant
-- scope are derived from groups (auth/authorize.js), not looked up from a
-- hardcoded username map (config.js: auth.personaByUser — retired this
-- prompt). `persona` is kept and now derived FROM groups at session-create
-- time, not read from a separate map at request time — see auth/index.js.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS groups TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN sessions.groups IS
  'OIDC groups claim at the time this session was created (Prompt 18). Source of truth for roles/tenant scope — see auth/authorize.js groupsToIdentity().';

-- Session security (Prompt 18 Deliverable 6): idle-timeout, not just an
-- absolute TTL. requireSession checks both expires_at AND that last_seen_at
-- is recent; a session left untouched past the idle window is rejected even
-- if its absolute TTL has not yet elapsed.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN sessions.last_seen_at IS
  'Updated on every authenticated request. Prompt 18 idle-timeout check.';
