# auth-userpass.tf — Prompt 14.5
# Demo human authentication for the Arcanium UI/API. POC only — passwords here
# are not secrets. Production swaps this for a Vault OIDC mount + an IdP.
#
# The imperative equivalent is scripts/vault-seed-users.sh.

resource "vault_auth_backend" "userpass" {
  type = "userpass"
  path = "userpass"
}

locals {
  arcanium_users = {
    ciso          = "Arcanium-ciso-2026"
    architect     = "Arcanium-arch-2026"
    operator      = "Arcanium-ops-2026"
    auditor       = "Arcanium-audit-2026"
    "pepsi-admin"    = "Arcanium-pepsi-2026"
    "cocacola-admin" = "Arcanium-cocacola-2026"
  }
}

resource "vault_generic_endpoint" "arcanium_user" {
  for_each             = local.arcanium_users
  path                 = "auth/userpass/users/${each.key}"
  ignore_absent_fields = true
  disable_read         = true
  disable_delete       = false

  data_json = jsonencode({
    password       = each.value
    token_policies = ["default"]
    token_ttl      = "1h"
  })

  depends_on = [vault_auth_backend.userpass]
}
