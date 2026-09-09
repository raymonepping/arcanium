# ── Intermediate CA ───────────────────────────────────────────────────────────

# 1. Generate a CSR from the intermediate CA mount.
resource "vault_pki_secret_backend_intermediate_cert_request" "arcanium_int_csr" {
  backend     = vault_mount.pki_int.path
  type        = "internal"
  common_name = "Arcanium Intermediate CA"
  key_type    = "rsa"
  key_bits    = 4096
  format      = "pem"
}

# 2. Sign the CSR with the root CA.
resource "vault_pki_secret_backend_root_sign_intermediate" "arcanium_int_signed" {
  backend      = vault_mount.pki_root.path
  csr          = vault_pki_secret_backend_intermediate_cert_request.arcanium_int_csr.csr
  common_name  = "Arcanium Intermediate CA"
  ttl          = "43800h" # 5 years
  format       = "pem_bundle"
}

# 3. Set the signed cert back on the intermediate mount.
resource "vault_pki_secret_backend_intermediate_set_signed" "arcanium_int_set" {
  backend     = vault_mount.pki_int.path
  certificate = vault_pki_secret_backend_root_sign_intermediate.arcanium_int_signed.certificate
}

# Configure CRL and issuing certificate URLs for the intermediate CA.
resource "vault_pki_secret_backend_config_urls" "pki_int_urls" {
  backend                 = vault_mount.pki_int.path
  issuing_certificates    = ["https://vault-1:8200/v1/pki-int/ca"]
  crl_distribution_points = ["https://vault-1:8200/v1/pki-int/crl"]
}
