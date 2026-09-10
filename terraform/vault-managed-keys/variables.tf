variable "vault_hsm_addr" {
  type        = string
  description = "vault-hsm API address"
  default     = "https://127.0.0.1:18300"
}

variable "vault_ca_cert" {
  type        = string
  description = "Path to the Vault CA chain"
  default     = "../../vault-tls/ca-chain.pem"
}

variable "softhsm_slot" {
  type        = string
  description = "Resolved SoftHSM2 slot id (from .secrets/hsm/slot-id)"
}

variable "softhsm_pin" {
  type        = string
  sensitive   = true
  description = "SoftHSM2 user PIN (SOFTHSM_USER_PIN)"
}
