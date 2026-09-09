output "approle_arcanium_api_role_id" {
  description = "AppRole role_id for arcanium-api (used by the Arcanium API service)"
  value       = vault_approle_auth_backend_role.arcanium_api.role_id
  sensitive   = false
}

output "approle_path" {
  description = "AppRole auth mount path"
  value       = vault_auth_backend.approle.path
}

output "arcanium_namespace" {
  description = "Vault namespace created for Arcanium"
  value       = vault_namespace.arcanium.path
}
