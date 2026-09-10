variable "vault_addr" {
  type    = string
  default = "https://127.0.0.1:18200"
}

variable "vault_cacert" {
  type    = string
  default = "../../vault-tls/ca-chain.pem"
}
