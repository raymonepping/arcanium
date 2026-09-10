# Auth backend — in cocacola namespace
resource "vault_auth_backend" "cocacola_approle" {
  provider = vault.cocacola
  type     = "approle"
  path     = "approle"

  depends_on = [vault_namespace.cocacola]
}

# Transit engine — in cocacola namespace
resource "vault_mount" "cocacola_transit" {
  provider = vault.cocacola
  path     = "transit"
  type     = "transit"

  depends_on = [vault_namespace.cocacola]
}

# Standard RSA-4096 Transit key — in cocacola namespace.
resource "vault_transit_secret_backend_key" "cocacola_signing" {
  provider         = vault.cocacola
  backend          = vault_mount.cocacola_transit.path
  name             = "cocacola-signing-key"
  type             = "rsa-4096"
  deletion_allowed = true
  exportable       = false
}

# Policy: cocacola approver can authorise control group requests — in cocacola namespace
resource "vault_policy" "cocacola_approver" {
  provider = vault.cocacola
  name     = "cocacola-approver-policy"

  policy = <<-EOT
    path "sys/control-group/authorize" {
      capabilities = ["create", "update"]
    }
    path "sys/control-group/request" {
      capabilities = ["read"]
    }
  EOT

  depends_on = [vault_namespace.cocacola]
}

# Policy: cocacola workload can sign/verify its own key — in cocacola namespace.
resource "vault_policy" "cocacola_workload" {
  provider = vault.cocacola
  name     = "cocacola-workload-policy"

  policy = <<-EOT
    path "transit/sign/cocacola-signing-key" {
      capabilities = ["update"]
    }
    path "transit/verify/cocacola-signing-key" {
      capabilities = ["update"]
    }
    path "transit/keys/cocacola-signing-key" {
      capabilities = ["read"]
    }
  EOT

  depends_on = [vault_namespace.cocacola]
}

# AppRole for cocacola workload — in cocacola namespace
resource "vault_approle_auth_backend_role" "cocacola_app" {
  provider       = vault.cocacola
  backend        = vault_auth_backend.cocacola_approle.path
  role_name      = "cocacola-app-role"
  token_policies = ["cocacola-workload-policy"]
  token_ttl      = 3600
  token_max_ttl  = 14400

  depends_on = [vault_policy.cocacola_workload]
}

# AppRole for cocacola approver — in cocacola namespace
resource "vault_approle_auth_backend_role" "cocacola_approver_role" {
  provider       = vault.cocacola
  backend        = vault_auth_backend.cocacola_approle.path
  role_name      = "cocacola-approver-role"
  token_policies = ["cocacola-approver-policy"]
  token_ttl      = 3600
  token_max_ttl  = 14400

  depends_on = [vault_policy.cocacola_approver]
}
