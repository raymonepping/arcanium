output "pepsi_namespace" {
  description = "Vault namespace path for Pepsi supplier"
  value       = vault_namespace.pepsi.path
}

output "cocacola_namespace" {
  description = "Vault namespace path for Cocacola supplier"
  value       = vault_namespace.cocacola.path
}

output "pepsi_app_role_name" {
  description = "AppRole name for Pepsi workload"
  value       = vault_approle_auth_backend_role.pepsi_app.role_name
}

output "cocacola_app_role_name" {
  description = "AppRole name for Cocacola workload"
  value       = vault_approle_auth_backend_role.cocacola_app.role_name
}
