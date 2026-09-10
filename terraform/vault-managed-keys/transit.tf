# Transit mount on vault-hsm, allowing the docsign-hsm managed key.
resource "vault_mount" "transit" {
  path                 = "transit"
  type                 = "transit"
  allowed_managed_keys = ["docsign-hsm"]
}

# The signing key workloads use. type = managed_key routes sign/verify through
# SoftHSM instead of Vault's software key store.
resource "vault_transit_secret_backend_key" "document_signing_key" {
  backend          = vault_mount.transit.path
  name             = "document-signing-key"
  type             = "managed_key"
  managed_key_name = "docsign-hsm"
  deletion_allowed = false
  exportable       = false

  depends_on = [vault_managed_keys.docsign]
}

# ── Workload + API auth ─────────────────────────────────────────────────────
resource "vault_auth_backend" "approle" {
  type = "approle"
}

resource "vault_policy" "document_signing" {
  name   = "document-signing"
  policy = <<-EOT
    path "transit/sign/document-signing-key"        { capabilities = ["update"] }
    path "transit/verify/document-signing-key"      { capabilities = ["update"] }
    path "transit/keys/document-signing-key"        { capabilities = ["read"] }
    path "transit/keys/document-signing-key/rotate" { capabilities = ["update"] }
  EOT
}

resource "vault_approle_auth_backend_role" "document_signing" {
  backend        = vault_auth_backend.approle.path
  role_name      = "document-signing"
  token_policies = [vault_policy.document_signing.name]
  token_ttl      = 3600
  token_max_ttl  = 14400
}

resource "vault_policy" "arcanium_hsm_read" {
  name   = "arcanium-hsm-read"
  policy = <<-EOT
    path "sys/managed-keys/pkcs11"   { capabilities = ["list"] }
    path "sys/managed-keys/pkcs11/*" { capabilities = ["read"] }
    path "transit/keys"             { capabilities = ["list"] }
    path "transit/keys/*"           { capabilities = ["read"] }
    path "sys/health"               { capabilities = ["read"] }
  EOT
}

resource "vault_approle_auth_backend_role" "arcanium_hsm_read" {
  backend        = vault_auth_backend.approle.path
  role_name      = "arcanium-hsm-read"
  token_policies = [vault_policy.arcanium_hsm_read.name]
  token_ttl      = 3600
  token_max_ttl  = 86400
  token_period   = 3600
}
