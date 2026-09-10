output "managed_key_name" {
  value       = "docsign-hsm"
  description = "PKCS#11 managed key backing document-signing-key"
}

output "document_signing_role_id" {
  value       = vault_approle_auth_backend_role.document_signing.role_id
  description = "role_id for the document-signing workload (DOCSIGN_VAULT_ROLE_ID)"
}

output "arcanium_hsm_read_role_id" {
  value       = vault_approle_auth_backend_role.arcanium_hsm_read.role_id
  description = "role_id for the Arcanium API read-only vault-hsm client (ARCANIUM_HSM_ROLE_ID)"
}
