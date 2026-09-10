variable "vault_addr" {
  type    = string
  default = "https://127.0.0.1:18200"
}

variable "vault_cacert" {
  type    = string
  default = "../../vault-tls/ca-chain.pem"
}

# ── Emulated KMS distribution (Prompt 15.5) ─────────────────────────────────
# No real cloud account is ever used. When true (and compose/kms-sim is up) the
# awskms provider is pointed at LocalStack and the key is distributed there.
variable "kmse_emulated" {
  type        = bool
  default     = false
  description = "Distribute arcanium-distributed to the LocalStack emulated KMS (compose/kms-sim must be up)."
}

variable "kmse_emulated_endpoint" {
  type        = string
  default     = "http://arcanium-localstack:4566"
  description = "LocalStack KMS endpoint as reachable from the Vault nodes."
}

variable "kmse_emulated_region" {
  type    = string
  default = "us-east-1"
}
