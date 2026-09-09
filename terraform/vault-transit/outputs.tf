output "transit_mount_path" {
  description = "Transit secrets engine mount path"
  value       = vault_mount.transit.path
}

output "demo_app_key_name" {
  description = "Name of the demo application transit key"
  value       = vault_transit_secret_backend_key.demo_app_key.name
}
