# terraform/vault-keymgmt/ — Prompt 14.3 + 15.5
#
# Key Management secrets engine: Vault generates and owns a key, then distributes
# a copy to an external KMS and manages its lifecycle there (create → rotate →
# remove). This is the third enterprise key-management pattern (input/02 §2):
#   1. crypto-as-a-service   App → Vault Transit           (done)
#   2. standard key mgmt     Consumer → Vault KMIP          (done)
#   3. external key custody  Vault → external KMS           (this module)
#
# Requires the "Key Management Secrets Engine" licence feature (present in the
# 2.1-ent licence — verify with scripts/vault-check-entitlement.sh).
#
# The engine + Vault-owned key are always created. Distribution is demonstrated
# WITHOUT a real cloud account: when var.kmse_emulated = true and compose/kms-sim
# (LocalStack, KMS service only) is up, the awskms provider is pointed at
# http://arcanium-localstack:4566 with dummy credentials and the key is
# distributed there. The UI labels this "emulated · LocalStack". A real cloud KMS
# is the same config with the `endpoint` override removed and real credentials.

terraform {
  required_version = ">= 1.6"
  required_providers {
    vault = { source = "hashicorp/vault", version = "~> 4.4" }
  }
  backend "local" {
    path = "../../.secrets/terraform/vault-keymgmt.tfstate"
  }
}

provider "vault" {
  address      = var.vault_addr
  ca_cert_file = var.vault_cacert
}

resource "vault_mount" "keymgmt" {
  path = "keymgmt"
  type = "keymgmt"
}

# The Vault-owned key. `vault_generic_endpoint` is used throughout this module
# rather than typed resources — the hashicorp/vault provider ships no
# keymgmt-specific resource types, and this keeps the exact request bodies
# (especially the awskms `endpoint` override) explicit and version-independent.
resource "vault_generic_endpoint" "distributed_key" {
  path                 = "${vault_mount.keymgmt.path}/key/arcanium-distributed"
  ignore_absent_fields = true
  disable_delete       = false

  data_json = jsonencode({
    type             = "aes256-gcm96"
    deletion_allowed = true
  })
}

# ── Emulated KMS provider (LocalStack) ──────────────────────────────────────
# Only created when var.kmse_emulated = true.
resource "vault_generic_endpoint" "localstack_kms" {
  count                = var.kmse_emulated ? 1 : 0
  depends_on           = [vault_mount.keymgmt]
  path                 = "${vault_mount.keymgmt.path}/kms/localstack"
  ignore_absent_fields = true
  disable_read         = true
  disable_delete       = false

  data_json = jsonencode({
    provider       = "awskms"
    key_collection = var.kmse_emulated_region
    credentials = {
      access_key = "test"
      secret_key = "test"
      endpoint   = var.kmse_emulated_endpoint
      region     = var.kmse_emulated_region
    }
  })
}

# Distribute the Vault-owned key to the emulated KMS.
resource "vault_generic_endpoint" "localstack_distribute" {
  count                = var.kmse_emulated ? 1 : 0
  depends_on           = [vault_generic_endpoint.localstack_kms, vault_generic_endpoint.distributed_key]
  path                 = "${vault_mount.keymgmt.path}/kms/localstack/key/arcanium-distributed"
  ignore_absent_fields = true
  disable_read         = true
  disable_delete       = false

  data_json = jsonencode({
    purpose    = "encrypt,decrypt"
    protection = "hsm"
  })
}
