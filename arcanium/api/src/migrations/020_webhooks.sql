-- 020_webhooks.sql — Prompt 28, Deliverable 3: webhook / event emission.
--
-- Real gap found in this prompt's own illustrative schema, fixed here (the
-- same "prove it, don't assume it" standard this repo holds itself to
-- elsewhere): `secret_hash` alone (a SHA-256 digest) can verify a secret a
-- caller later presents, but it CANNOT be used to compute an HMAC
-- signature for future outgoing deliveries — HMAC needs the actual key
-- bytes, and a hash is one-way by design. Arcanium is the one SIGNING
-- these payloads (not verifying someone else's), so it must be able to
-- recover the real secret at delivery time. Fixed the same way every
-- other at-rest secret in this codebase is handled: Vault Transit
-- encryption, not a home-rolled reversible scheme — `secret_ciphertext`
-- holds the Vault-encrypted secret; `secret_hash` is kept too, exactly as
-- specified, as a non-secret fingerprint for audit/display use.
CREATE TABLE webhook_endpoints (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url                TEXT NOT NULL,
  events             TEXT[] NOT NULL,   -- e.g. ['reconciliation.drifted', 'key.expiry_approaching']
  secret_hash        TEXT NOT NULL,     -- SHA-256 fingerprint of the signing secret — audit/display only
  secret_ciphertext  TEXT NOT NULL,     -- Vault Transit-encrypted signing secret — decrypted only at delivery time
  enabled            BOOLEAN NOT NULL DEFAULT true,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     UUID NOT NULL REFERENCES webhook_endpoints(id),
  event           TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,   -- SHA-256 of the payload sent — never the payload itself
  http_status     INTEGER,
  delivered_at    TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  attempt_count   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, id DESC);
-- Deliverable 8's fitness test needs to find failed deliveries quickly
-- ("surfaced in the observability dashboard, not silently dropped").
CREATE INDEX idx_webhook_deliveries_failed ON webhook_deliveries (failed_at) WHERE failed_at IS NOT NULL;

DO $$ BEGIN
  EXECUTE 'ALTER TABLE webhook_endpoints OWNER TO arcanium';
  EXECUTE 'ALTER TABLE webhook_deliveries OWNER TO arcanium';
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;
