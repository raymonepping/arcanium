# terraform/vault-managed-keys/ — Prompt 14.1
#
# Managed Key custody demo on the vault-hsm node: the document-signing RSA-4096
# private key is generated in and never leaves SoftHSM (PKCS#11). Vault Transit
# delegates sign/verify to the token.
#
# This module targets vault-hsm (the only node running the +ent.hsm binary — the
# plain +ent binary on vault-1/2/3 returns "unsupported managed key type").
#
# The equivalent imperative path is scripts/vault-hsm-bootstrap.sh, which is what
# `make hsm-managed-keys` runs. This module documents the desired state and can
# be applied directly when a vault-hsm token is exported as VAULT_TOKEN.

terraform {
  required_version = ">= 1.6"
  required_providers {
    vault = {
      source  = "hashicorp/vault"
      version = "~> 4.4"
    }
  }
}

provider "vault" {
  address         = var.vault_hsm_addr
  ca_cert_file    = var.vault_ca_cert
  skip_child_token = true
}
