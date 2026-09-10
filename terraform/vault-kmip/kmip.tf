# Enable KMIP secrets engine at kmip/
resource "vault_kmip_secret_backend" "kmip" {
  path                        = "kmip"
  description                 = "Arcanium KMIP engine — legacy database consumer"
  default_tls_client_ttl      = 604800    # 7 days — matches system max_lease_ttl
  default_tls_client_key_type = "rsa"
  default_tls_client_key_bits = 2048

  listen_addrs = ["0.0.0.0:5696"]

  tls_ca_key_type = "rsa"
  tls_ca_key_bits = 4096
}

# KMIP scope: arcanium (root namespace — legacy-database consumer)
resource "vault_kmip_secret_scope" "arcanium" {
  path  = vault_kmip_secret_backend.kmip.path
  scope = "arcanium"
  force = true
}

# KMIP role: legacy-db — full object lifecycle operations
resource "vault_kmip_secret_role" "legacy_db" {
  path                     = vault_kmip_secret_scope.arcanium.path
  scope                    = vault_kmip_secret_scope.arcanium.scope
  role                     = "legacy-db"
  tls_client_key_type      = "rsa"
  tls_client_key_bits      = 2048
  operation_create              = true
  operation_activate            = true
  operation_get                 = true
  operation_get_attributes      = true
  operation_get_attribute_list  = true
  operation_locate              = true
  operation_revoke              = true
  operation_destroy             = true
}
