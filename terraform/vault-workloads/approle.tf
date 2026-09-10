# ── AppRole roles for demo workloads ─────────────────────────────────────
# These depend on vault_auth_backend.approle in vault-platform being applied first.
#
# Every workload role carries the "automation" marker policy (Prompt 15.5) — it
# grants no capabilities, but the Sentinel `rotation-from-automation` EGP keys off
# its presence: a workload/automation identity may rotate a transit key, a human
# token (which never carries it) may not.

resource "vault_approle_auth_backend_role" "payments_workload" {
  backend        = "approle"
  role_name      = "payments-workload"
  token_policies = ["payments-api-policy", "automation"]
  token_ttl      = 3600
  token_max_ttl  = 14400
}

resource "vault_approle_auth_backend_role" "pki_workload" {
  backend        = "approle"
  role_name      = "pki-workload"
  token_policies = ["pki-client-policy", "automation"]
  token_ttl      = 3600
  token_max_ttl  = 14400
}

resource "vault_approle_auth_backend_role" "document_signing_workload" {
  backend        = "approle"
  role_name      = "document-signing-workload"
  token_policies = ["document-signing-policy", "automation"]
  token_ttl      = 3600
  token_max_ttl  = 14400
}
