# ── PKI roles ─────────────────────────────────────────────────────────────────

# arcanium-services — issues certificates for *.arcanium.local SANs.
# Used by internal Arcanium API services and workload containers.
resource "vault_pki_secret_backend_role" "arcanium_services" {
  backend          = vault_mount.pki_int.path
  name             = "arcanium-services"
  ttl              = "720h"    # 30 days
  max_ttl          = "8760h"   # 1 year
  allow_subdomains = true
  allowed_domains  = ["arcanium.local"]
  key_type         = "rsa"
  key_bits         = 2048
  require_cn       = true

  # Allow IP SANs for container-to-container mTLS.
  allow_ip_sans    = true

  # These should remain false — force use of allowed_domains.
  allow_any_name          = false
  allow_glob_domains      = false
  enforce_hostnames       = true
  server_flag             = true
  client_flag             = true
  code_signing_flag       = false
  email_protection_flag   = false
}
