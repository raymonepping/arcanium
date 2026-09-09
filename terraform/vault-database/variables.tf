variable "vault_addr" {
  description = "Vault API address"
  type        = string
  default     = "https://127.0.0.1:18200"
}

variable "vault_cacert" {
  description = "Path to the Vault CA certificate"
  type        = string
  default     = "../../vault-tls/ca-chain.pem"
}

variable "postgres_host" {
  description = "PostgreSQL hostname reachable from the Vault container. Uses host-published port via host.containers.internal so Vault can reach Postgres without sharing a network."
  type        = string
  default     = "host.containers.internal"
}

variable "postgres_port" {
  description = "PostgreSQL port"
  type        = number
  default     = 5432
}

variable "postgres_user" {
  description = "PostgreSQL management superuser (Vault uses this to manage dynamic credentials)"
  type        = string
  sensitive   = true
}

variable "postgres_password" {
  description = "PostgreSQL management password (stored in Vault, never exposed to app)"
  type        = string
  sensitive   = true
}

variable "postgres_db" {
  description = "PostgreSQL database name"
  type        = string
  default     = "arcanium_db"
}
