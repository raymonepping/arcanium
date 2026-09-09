terraform {
  required_providers {
    vault = {
      source  = "hashicorp/vault"
      version = "~> 4.0"
    }
  }
  backend "local" {
    path = "../../.secrets/terraform/vault-pki.tfstate"
  }
}

provider "vault" {
  address         = var.vault_addr
  # Token supplied via VAULT_TOKEN env var (from .secrets/vault/cluster-init.json)
  skip_tls_verify = false
  ca_cert_file    = var.vault_cacert
}
