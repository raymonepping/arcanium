variable "vault_addr" {
  description = "Vault API address"
  type        = string
  default     = "https://127.0.0.1:18200"
}

variable "vault_cacert" {
  description = "Path to the Vault CA certificate (PEM)"
  type        = string
}

variable "approle_path" {
  description = "Mount path of the AppRole auth backend (created by terraform/vault-platform)"
  type        = string
  default     = "approle"
}
