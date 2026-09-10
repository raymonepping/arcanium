terraform {
  required_providers {
    vault = {
      source  = "hashicorp/vault"
      version = "~> 4.0"
    }
  }

  backend "local" {
    path = "../../.secrets/terraform/vault-kmip.tfstate"
  }
}

provider "vault" {
  address      = var.vault_addr
  ca_cert_file = var.vault_cacert
  # VAULT_TOKEN must be set in the environment
}
