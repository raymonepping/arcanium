output "kmip_path" {
  description = "KMIP secrets engine mount path"
  value       = vault_kmip_secret_backend.kmip.path
}

output "kmip_scope" {
  description = "KMIP scope for the legacy-database consumer"
  value       = vault_kmip_secret_scope.arcanium.scope
}

output "kmip_role" {
  description = "KMIP role name for the legacy-database consumer"
  value       = vault_kmip_secret_role.legacy_db.role
}
