# ── Root CA ───────────────────────────────────────────────────────────────────

resource "vault_pki_secret_backend_root_cert" "arcanium_root" {
  backend     = vault_mount.pki_root.path
  type        = "internal"
  common_name = "Arcanium Root CA"
  ttl         = "87600h" # 10 years
  format      = "pem"
  key_type    = "rsa"
  key_bits    = 4096

}

# Configure the CRL and issuing certificate URLs for the root CA.
resource "vault_pki_secret_backend_config_urls" "pki_root_urls" {
  backend                 = vault_mount.pki_root.path
  issuing_certificates    = ["https://vault-1:8200/v1/pki/ca"]
  crl_distribution_points = ["https://vault-1:8200/v1/pki/crl"]
}
