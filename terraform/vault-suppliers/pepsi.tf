# Auth backend — in pepsi namespace
resource "vault_auth_backend" "pepsi_approle" {
  provider = vault.pepsi
  type     = "approle"
  path     = "approle"

  depends_on = [vault_namespace.pepsi]
}

# Transit engine — in pepsi namespace
resource "vault_mount" "pepsi_transit" {
  provider = vault.pepsi
  path     = "transit"
  type     = "transit"

  depends_on = [vault_namespace.pepsi]
}

# Standard RSA-4096 Transit key — in pepsi namespace.
# Supplier keys use normal Vault Transit; isolation is via namespace boundaries.
resource "vault_transit_secret_backend_key" "pepsi_signing" {
  provider         = vault.pepsi
  backend          = vault_mount.pepsi_transit.path
  name             = "pepsi-signing-key"
  type             = "rsa-4096"
  deletion_allowed = true  # true to allow the governed DELETE demonstration
  exportable       = false
}

# Policy: pepsi approver can authorise control group requests — in pepsi namespace
resource "vault_policy" "pepsi_approver" {
  provider = vault.pepsi
  name     = "pepsi-approver-policy"

  policy = <<-EOT
    path "sys/control-group/authorize" {
      capabilities = ["create", "update"]
    }
    path "sys/control-group/request" {
      capabilities = ["read"]
    }
  EOT

  depends_on = [vault_namespace.pepsi]
}

# Policy: pepsi workload can sign/verify its own key — in pepsi namespace.
resource "vault_policy" "pepsi_workload" {
  provider = vault.pepsi
  name     = "pepsi-workload-policy"

  policy = <<-EOT
    path "transit/sign/pepsi-signing-key" {
      capabilities = ["update"]
    }
    path "transit/verify/pepsi-signing-key" {
      capabilities = ["update"]
    }
    path "transit/keys/pepsi-signing-key" {
      capabilities = ["read"]
    }
  EOT

  depends_on = [vault_namespace.pepsi]
}

# AppRole for pepsi workload — in pepsi namespace
resource "vault_approle_auth_backend_role" "pepsi_app" {
  provider       = vault.pepsi
  backend        = vault_auth_backend.pepsi_approle.path
  role_name      = "pepsi-app-role"
  token_policies = ["pepsi-workload-policy"]
  token_ttl      = 3600
  token_max_ttl  = 14400

  depends_on = [vault_policy.pepsi_workload]
}

# AppRole for pepsi approver — in pepsi namespace
resource "vault_approle_auth_backend_role" "pepsi_approver_role" {
  provider       = vault.pepsi
  backend        = vault_auth_backend.pepsi_approle.path
  role_name      = "pepsi-approver-role"
  token_policies = ["pepsi-approver-policy"]
  token_ttl      = 3600
  token_max_ttl  = 14400

  depends_on = [vault_policy.pepsi_approver]
}
