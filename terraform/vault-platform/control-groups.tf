# Policy: external-supplier can request Transit encrypt — Vault Enterprise Control Groups
# gate the operation. The first attempt returns wrap_info (accessor + token) instead of
# ciphertext. An approver in the crypto-approvers group must call sys/control-group/authorize
# before the requester can unwrap the response.
# Requires: governance-policy module in the Vault Enterprise license (available in 2.1-ent).
resource "vault_policy" "external_supplier" {
  name = "external-supplier-policy"

  policy = <<-EOT
    path "transit/encrypt/external-supplier-key" {
      capabilities = ["update"]
      control_group = {
        factor "authorise-crypto-ops" {
          identity {
            group_names = ["crypto-approvers"]
            approvals   = 1
          }
        }
        ttl = "30m"
      }
    }
  EOT
}

# Approver policy — can authorize control group requests and call transit directly
resource "vault_policy" "crypto_approver" {
  name = "crypto-approver-policy"

  policy = <<-EOT
    path "sys/control-group/authorize" {
      capabilities = ["create", "update"]
    }
    path "sys/control-group/request" {
      capabilities = ["read"]
    }
    path "transit/encrypt/external-supplier-key" {
      capabilities = ["update"]
    }
  EOT
}

# AppRole: external-supplier (the requester — gated by control group)
resource "vault_approle_auth_backend_role" "external_supplier" {
  backend        = vault_auth_backend.approle.path
  role_name      = "external-supplier"
  token_policies = ["external-supplier-policy"]
  token_ttl      = 1800
  token_max_ttl  = 7200
}

# AppRole: approver-1 (the human approver — used in approve.sh demo)
resource "vault_approle_auth_backend_role" "approver_1" {
  backend        = vault_auth_backend.approle.path
  role_name      = "approver-1"
  token_policies = ["crypto-approver-policy"]
  token_ttl      = 3600
  token_max_ttl  = 14400
}

# Identity entity for approver-1 — ROOT namespace (global identity store)
resource "vault_identity_entity" "approver_1" {
  name = "arcanium-approver-1"
}

# Entity alias — for AppRole, the alias name MUST be the role_id UUID, not the role name.
# Vault matches the AppRole login to an entity by looking up (mount_accessor, role_id).
resource "vault_identity_entity_alias" "approver_1_approle" {
  name           = vault_approle_auth_backend_role.approver_1.role_id
  mount_accessor = vault_auth_backend.approle.accessor
  canonical_id   = vault_identity_entity.approver_1.id
}

# Identity group: crypto-approvers → member approver-1
resource "vault_identity_group" "crypto_approvers" {
  name              = "crypto-approvers"
  type              = "internal"
  member_entity_ids = [vault_identity_entity.approver_1.id]
}
