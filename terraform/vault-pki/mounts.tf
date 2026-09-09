# ── PKI secrets engines ───────────────────────────────────────────────────────

# Root CA mount — long-lived offline-style root, no direct issuance.
resource "vault_mount" "pki_root" {
  path                      = "pki"
  type                      = "pki"
  description               = "Arcanium Root CA"
  default_lease_ttl_seconds = 315360000  # 10 years
  max_lease_ttl_seconds     = 315360000  # 10 years
}

# Intermediate CA mount — all certificate issuance goes through here.
resource "vault_mount" "pki_int" {
  path                      = "pki-int"
  type                      = "pki"
  description               = "Arcanium Intermediate CA"
  default_lease_ttl_seconds = 2592000   # 30 days
  max_lease_ttl_seconds     = 157680000 # 5 years
}
