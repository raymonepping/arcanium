# ── AppRole auth method ───────────────────────────────────────────────────────

resource "vault_auth_backend" "approle" {
  type = "approle"
  path = "approle"
}

# Role used by the Arcanium API service to authenticate and retrieve dynamic
# database credentials and perform transit/PKI operations.
resource "vault_approle_auth_backend_role" "arcanium_api" {
  backend        = vault_auth_backend.approle.path
  role_name      = "arcanium-api"
  token_policies = ["arcanium-admin", "arcanium-transit", "arcanium-pki"]
  token_ttl      = 3600   # 1 hour — matches DB dynamic cred TTL
  token_max_ttl  = 14400  # 4 hours
}

# Role used by workload containers to authenticate and read their own secrets.
resource "vault_approle_auth_backend_role" "workload_generic" {
  backend        = vault_auth_backend.approle.path
  role_name      = "workload-generic"
  token_policies = ["workload-read-only"]
  token_ttl      = 1800
  token_max_ttl  = 7200
}
