terraform {
  required_providers {
    vault = {
      source  = "hashicorp/vault"
      version = "~> 4.0"
    }
  }

  backend "local" {
    path = "../../.secrets/terraform/vault-suppliers.tfstate"
  }
}

# Root namespace provider — used to create namespace resources
provider "vault" {
  address      = var.vault_addr
  ca_cert_file = var.vault_cacert
}

# Pepsi supplier namespace provider
provider "vault" {
  alias        = "pepsi"
  address      = var.vault_addr
  ca_cert_file = var.vault_cacert
  namespace    = "suppliers/pepsi/"   # trailing slash required for child namespaces
}

# Cocacola supplier namespace provider
provider "vault" {
  alias        = "cocacola"
  address      = var.vault_addr
  ca_cert_file = var.vault_cacert
  namespace    = "suppliers/cocacola/"   # trailing slash required for child namespaces
}
