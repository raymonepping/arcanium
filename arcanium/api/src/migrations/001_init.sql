CREATE TABLE IF NOT EXISTS applications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL UNIQUE,
  description   TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crypto_profiles (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL CHECK (type IN ('transit','pki','kmip','managed_key')),
  vault_path     TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, vault_path)
);

CREATE INDEX IF NOT EXISTS idx_crypto_profiles_application_id
  ON crypto_profiles(application_id);
