# ── AppRole auth method ───────────────────────────────────────────────────────

resource "vault_auth_backend" "approle" {
  type = "approle"
  path = "approle"
}

# Role used by the Arcanium API service to authenticate and retrieve dynamic
# database credentials and perform transit/PKI operations.
resource "vault_approle_auth_backend_role" "arcanium_api" {
  backend   = vault_auth_backend.approle.path
  role_name = "arcanium-api"
  # "automation" is the Sentinel marker policy (terraform/vault-sentinel/) — its
  # presence lets the platform's own worker rotate keys via the
  # rotation-from-automation RGP; a human token carries no such policy.
  token_policies = ["arcanium-admin", "arcanium-transit", "arcanium-pki", "automation"]
  token_ttl      = 3600  # 1 hour — matches DB dynamic cred TTL
  token_max_ttl  = 14400 # 4 hours
  secret_id_ttl  = 7776000 # 90 days — vault-rotator proactively renews at 60 days
}

# Role used by the vault-rotator sidecar to authenticate and generate fresh
# secret-ids for arcanium-api before the 90-day TTL expires.
# Uses a periodic token (token_period) so the sidecar can run indefinitely
# without hitting token_max_ttl. Its own secret_id_ttl = 0 (no expiry) because
# the rotator's own bootstrap secret-id is seeded once at deploy time via .env.
resource "vault_approle_auth_backend_role" "approle_rotator" {
  backend        = vault_auth_backend.approle.path
  role_name      = "approle-rotator"
  token_policies = [vault_policy.approle_rotator.name]
  token_ttl      = 3600
  token_max_ttl  = 86400
  token_period   = 86400
  secret_id_ttl  = 0 # Rotator's own identity is bootstrapped once via ROTATOR_SECRET_ID
}

# Role used by workload containers to authenticate and read their own secrets.
resource "vault_approle_auth_backend_role" "workload_generic" {
  backend        = vault_auth_backend.approle.path
  role_name      = "workload-generic"
  token_policies = ["workload-read-only"]
  token_ttl      = 1800
  token_max_ttl  = 7200
}
