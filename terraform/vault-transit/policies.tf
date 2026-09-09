# ── Transit policy ────────────────────────────────────────────────────────────
# Scoped to demo-app-key only — encrypt and decrypt, nothing else.
# The broader arcanium-transit policy (in vault-platform) covers all keys
# for the API service. This policy is for targeted service accounts.

resource "vault_policy" "transit_demo_app" {
  name = "transit-demo-app-key"

  policy = <<-EOT
    path "transit/encrypt/demo-app-key" {
      capabilities = ["update"]
    }
    path "transit/decrypt/demo-app-key" {
      capabilities = ["update"]
    }
    path "transit/rewrap/demo-app-key" {
      capabilities = ["update"]
    }
    path "transit/keys/demo-app-key" {
      capabilities = ["read"]
    }
  EOT
}
