output "root_ca_cert_pem" {
  description = "Root CA certificate PEM"
  value       = vault_pki_secret_backend_root_cert.arcanium_root.certificate
  sensitive   = false
}

output "intermediate_ca_cert_pem" {
  description = "Intermediate CA signed certificate PEM (bundle)"
  value       = vault_pki_secret_backend_root_sign_intermediate.arcanium_int_signed.certificate
  sensitive   = false
}

output "pki_root_mount" {
  description = "Root PKI secrets engine mount path"
  value       = vault_mount.pki_root.path
}

output "pki_int_mount" {
  description = "Intermediate PKI secrets engine mount path"
  value       = vault_mount.pki_int.path
}

output "arcanium_services_role" {
  description = "PKI role for arcanium-services certificate issuance"
  value       = vault_pki_secret_backend_role.arcanium_services.name
}
