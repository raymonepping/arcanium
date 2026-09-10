# ── Transit key for payments-api ─────────────────────────────────────────
# The demo-app-key and workload-key already exist from vault-transit.
# This is a dedicated key for the payments-api workload.

resource "vault_transit_secret_backend_key" "payments_api_key" {
  backend                 = "transit"
  name                    = "payments-api-key"
  type                    = "aes256-gcm96"
  deletion_allowed        = false
  exportable              = false
  allow_plaintext_backup  = false
  min_decryption_version  = 1
  min_encryption_version  = 0
}

# ── Transit key for external-supplier (AES-256-GCM96, Control Group gated) ──

resource "vault_transit_secret_backend_key" "external_supplier_key" {
  backend                = "transit"
  name                   = "external-supplier-key"
  type                   = "aes256-gcm96"
  deletion_allowed       = false
  exportable             = false
  allow_plaintext_backup = false
  min_decryption_version = 1
  min_encryption_version = 0
}

# ── Transit key for document-signing ─────────────────────────────────────
# SUPERSEDED by Prompt 14.1: document-signing-key now lives on vault-hsm as a
# Managed Key (SoftHSM PKCS#11 custody) — see terraform/vault-managed-keys/ and
# docs/managed-keys.md. This plain RSA-4096 key on the primary cluster is left in
# place (deletion_allowed = false) but is no longer used; the Arcanium API hides
# it in favour of the vault-hsm Managed Key of the same name.
resource "vault_transit_secret_backend_key" "document_signing_key" {
  backend                 = "transit"
  name                    = "document-signing-key"
  type                    = "rsa-4096"
  deletion_allowed        = false
  exportable              = false
  allow_plaintext_backup  = false
  min_decryption_version  = 1
  min_encryption_version  = 0
}
