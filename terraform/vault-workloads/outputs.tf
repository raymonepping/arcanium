output "payments_workload_role_id" {
  description = "AppRole role_id for payments-workload"
  value       = vault_approle_auth_backend_role.payments_workload.role_id
}

output "pki_workload_role_id" {
  description = "AppRole role_id for pki-workload"
  value       = vault_approle_auth_backend_role.pki_workload.role_id
}

output "payments_api_key_name" {
  description = "Transit key name for payments-api"
  value       = vault_transit_secret_backend_key.payments_api_key.name
}

output "document_signing_workload_role_id" {
  description = "AppRole role_id for document-signing-workload"
  value       = vault_approle_auth_backend_role.document_signing_workload.role_id
}

output "document_signing_key_name" {
  description = "Transit key name for document-signing"
  value       = vault_transit_secret_backend_key.document_signing_key.name
}
