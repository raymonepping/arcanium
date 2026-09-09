# ── Transit secrets engine ────────────────────────────────────────────────────

resource "vault_mount" "transit" {
  path                      = "transit"
  type                      = "transit"
  description               = "Arcanium Transit — application-layer encryption"
  default_lease_ttl_seconds = 3600
  max_lease_ttl_seconds     = 86400
}
