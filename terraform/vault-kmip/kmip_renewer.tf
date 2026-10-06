# kmip-renewer sidecar identity (compose/vault: arcanium-kmip_renewer).
#
# KMIP client certs are capped at 7 days (default_tls_client_ttl above). The
# legacy-db cert used to be issued once by scenarios/03_kmip/provision.sh and
# expired on 2026-09-22 — arcanium-kmip-client then restart-looped for two
# weeks. The renewer re-issues the cert inside a 48h window before expiry and
# revokes the previous serial.
#
# Scope: generate + revoke legacy-db credentials in the arcanium scope, and
# nothing else — it cannot create scopes/roles, touch other KMIP roles, or
# reach any other engine.
resource "vault_policy" "kmip_renewer" {
  name = "kmip-renewer"

  policy = <<-EOT
    path "${vault_kmip_secret_role.legacy_db.path}/scope/${vault_kmip_secret_role.legacy_db.scope}/role/${vault_kmip_secret_role.legacy_db.role}/credential/generate" {
      capabilities = ["update"]
    }

    path "${vault_kmip_secret_role.legacy_db.path}/scope/${vault_kmip_secret_role.legacy_db.scope}/role/${vault_kmip_secret_role.legacy_db.role}/credential/revoke" {
      capabilities = ["update"]
    }
  EOT
}

# Same shape as approle-rotator (terraform/vault-platform/auth.tf): periodic
# token so the sidecar can run indefinitely; secret_id_ttl = 0 because its
# bootstrap secret-id is seeded into .env by scripts/workload-credentials.sh
# (KMIP_RENEWER_SECRET_ID) on every `make up`.
resource "vault_approle_auth_backend_role" "kmip_renewer" {
  backend        = var.approle_path
  role_name      = "kmip-renewer"
  token_policies = [vault_policy.kmip_renewer.name]
  token_ttl      = 3600
  token_max_ttl  = 86400
  token_period   = 86400
  secret_id_ttl  = 0
}
