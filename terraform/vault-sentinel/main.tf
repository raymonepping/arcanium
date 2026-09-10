# terraform/vault-sentinel/ — Prompt 14.4
#
# Sentinel EGP (endpoint governing policy) — Vault becomes a policy enforcement
# point for the cryptographic key lifecycle (input/02 §15), not only a crypto
# engine.
#
# Requires the "Sentinel" licence feature (present in the 2.1-ent licence —
# verify with scripts/vault-check-entitlement.sh "Sentinel").

terraform {
  required_version = ">= 1.6"
  required_providers {
    vault = { source = "hashicorp/vault", version = "~> 4.4" }
  }
  backend "local" {
    path = "../../.secrets/terraform/vault-sentinel.tfstate"
  }
}

provider "vault" {
  address      = var.vault_addr
  ca_cert_file = var.vault_cacert
}

# Key destruction is a governed operation. A direct `transit/keys/*` delete via a
# normal token is denied; it must go through the Arcanium approval + Control
# Group flow, or a break-glass token carrying the approver policy.
resource "vault_egp_policy" "deny_unapproved_key_destroy" {
  name              = "deny-unapproved-key-destroy"
  paths             = ["transit/keys/*"]
  enforcement_level = "hard-mandatory"
  policy            = <<-EOT
    import "strings"

    is_transit_key_delete = rule {
        request.operation is "delete" and
        strings.has_prefix(request.path, "transit/keys/")
    }

    main = rule when is_transit_key_delete {
        "crypto-approver-policy" in token.policies
    }
  EOT
}

# The audit trail may not be disabled through the platform.
resource "vault_egp_policy" "protect_audit_devices" {
  name              = "protect-audit-devices"
  paths             = ["sys/audit/*"]
  enforcement_level = "hard-mandatory"
  policy            = <<-EOT
    main = rule {
        not request.operation is "delete"
    }
  EOT
}

# Prompt 15.5 — key rotation must come from an automation identity, not a human.
# Automation roles (workload-*, arcanium-*) carry the `automation` marker policy;
# a human token does not, and is denied.
resource "vault_egp_policy" "rotation_from_automation" {
  name              = "rotation-from-automation"
  paths             = ["transit/keys/*"]
  enforcement_level = "hard-mandatory"
  policy            = <<-EOT
    import "strings"

    is_rotate = rule {
        request.operation is "update" and
        strings.has_suffix(request.path, "/rotate") and
        strings.has_prefix(request.path, "transit/keys/")
    }

    main = rule when is_rotate {
        "automation" in token.policies
    }
  EOT
}

# Marker policy carried by automation identities (attached to workload approle roles).
resource "vault_policy" "automation" {
  name   = "automation"
  policy = "# automation marker — no capabilities, presence is the signal"
}
