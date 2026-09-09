output "database_creds_path" {
  description = "Path the Arcanium API reads to obtain dynamic PostgreSQL credentials"
  value       = "database/creds/${vault_database_secret_backend_role.arcanium_api.name}"
}

output "database_engine_path" {
  description = "Database secrets engine mount path"
  value       = vault_mount.database.path
}
