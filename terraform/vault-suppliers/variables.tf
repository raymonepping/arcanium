variable "vault_addr" {
  description = "Vault API address"
  type        = string
  default     = "https://127.0.0.1:18200"
}

variable "vault_cacert" {
  description = "Path to the Vault CA certificate (PEM)"
  type        = string
}

variable "sla_rate_per_minute" {
  description = "Request rate limit per supplier namespace (requests/minute)"
  type        = number
  default     = 60
}
