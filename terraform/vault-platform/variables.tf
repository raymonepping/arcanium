variable "vault_addr" {
  description = "Vault cluster address"
  type        = string
  default     = "https://127.0.0.1:18200"
}

variable "vault_cacert" {
  description = "Absolute path to the CA certificate for TLS verification"
  type        = string
  default     = ""
}

variable "vault_namespace" {
  description = "Vault namespace for Arcanium (Enterprise)"
  type        = string
  default     = ""
}
