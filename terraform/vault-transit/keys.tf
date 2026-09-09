# ── Transit keys ─────────────────────────────────────────────────────────────

# Demo application key — AES-256-GCM96 symmetric encryption.
# Arcanium API creates application-specific keys at runtime; this key is the
# foundational example used by demos and integration tests.
resource "vault_transit_secret_backend_key" "demo_app_key" {
  backend          = vault_mount.transit.path
  name             = "demo-app-key"
  type             = "aes256-gcm96"
  deletion_allowed = false
  exportable       = false
  allow_plaintext_backup = false
  min_decryption_version = 1
  min_encryption_version = 0
}

# Workload symmetric key — shared key for workload containers.
resource "vault_transit_secret_backend_key" "workload_key" {
  backend          = vault_mount.transit.path
  name             = "workload-key"
  type             = "aes256-gcm96"
  deletion_allowed = false
  exportable       = false
  allow_plaintext_backup = false
  min_decryption_version = 1
  min_encryption_version = 0
}
