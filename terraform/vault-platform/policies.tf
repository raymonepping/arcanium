# ── Vault policies ────────────────────────────────────────────────────────────
# Terraform owns the policy definitions (foundational desired state).
# Arcanium owns runtime bindings to specific keys/roles created at runtime.

# Full administrative access — used for initial platform setup only.
# Not assigned to the Arcanium API role in production.
resource "vault_policy" "arcanium_admin" {
  name = "arcanium-admin"

  policy = <<-EOT
    # ── Secrets engine mounts ────────────────────────────────────────────────
    path "sys/mounts" {
      capabilities = ["read", "list"]
    }
    path "sys/mounts/*" {
      capabilities = ["create", "read", "update", "delete", "list", "sudo"]
    }

    # ── Auth method management ───────────────────────────────────────────────
    path "sys/auth" {
      capabilities = ["read", "list"]
    }
    path "sys/auth/*" {
      capabilities = ["create", "read", "update", "delete", "list", "sudo"]
    }

    # ── Policy management ────────────────────────────────────────────────────
    path "sys/policies/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }
    path "sys/policy/*" {
      capabilities = ["create", "read", "update", "delete"]
    }

    # ── Namespaces (Enterprise) ──────────────────────────────────────────────
    path "sys/namespaces/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }

    # ── Identity ─────────────────────────────────────────────────────────────
    path "identity/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }

    # ── Audit ────────────────────────────────────────────────────────────────
    path "sys/audit" {
      capabilities = ["read", "list", "sudo"]
    }
    path "sys/audit/*" {
      capabilities = ["read", "list", "create", "sudo"]
    }

    # ── AppRole auth ─────────────────────────────────────────────────────────
    path "auth/approle/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }

    # ── Database dynamic credentials ─────────────────────────────────────────
    path "database/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }

    # ── Transit ──────────────────────────────────────────────────────────────
    path "transit/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }

    # ── PKI ──────────────────────────────────────────────────────────────────
    path "pki/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }
    path "pki-int/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }

    # ── Lease management ─────────────────────────────────────────────────────
    path "sys/leases/*" {
      capabilities = ["create", "read", "update", "delete", "list", "sudo"]
    }
    path "sys/renew" {
      capabilities = ["update"]
    }
    path "sys/revoke" {
      capabilities = ["update"]
    }

    # ── Control Groups (Enterprise) ──────────────────────────────────────────
    # Arcanium API acts as the approval proxy — calls authorize on behalf of approver
    path "sys/control-group/authorize" {
      capabilities = ["create", "update"]
    }
    path "sys/control-group/request" {
      capabilities = ["read"]
    }
    path "sys/wrapping/lookup" {
      capabilities = ["update"]
    }
  EOT
}

# Transit-scoped policy — encrypt/decrypt/sign/verify on the transit engine.
resource "vault_policy" "arcanium_transit" {
  name = "arcanium-transit"

  policy = <<-EOT
    path "transit/encrypt/*" {
      capabilities = ["update"]
    }
    path "transit/decrypt/*" {
      capabilities = ["update"]
    }
    path "transit/sign/*" {
      capabilities = ["update"]
    }
    path "transit/verify/*" {
      capabilities = ["update"]
    }
    path "transit/hmac/*" {
      capabilities = ["update"]
    }
    path "transit/rewrap/*" {
      capabilities = ["update"]
    }
    path "transit/datakey/*" {
      capabilities = ["update"]
    }
    path "transit/random" {
      capabilities = ["update"]
    }
    path "transit/keys" {
      capabilities = ["list"]
    }
    path "transit/keys/*" {
      capabilities = ["read"]
    }
  EOT
}

# PKI-scoped policy — issue and sign certificates only; no CA management.
resource "vault_policy" "arcanium_pki" {
  name = "arcanium-pki"

  policy = <<-EOT
    path "pki/issue/*" {
      capabilities = ["create", "update"]
    }
    path "pki/sign/*" {
      capabilities = ["create", "update"]
    }
    path "pki/cert/*" {
      capabilities = ["read"]
    }
    path "pki/certs" {
      capabilities = ["list"]
    }
    path "pki-int/issue/*" {
      capabilities = ["create", "update"]
    }
    path "pki-int/sign/*" {
      capabilities = ["create", "update"]
    }
    path "pki-int/cert/*" {
      capabilities = ["read"]
    }
    path "pki-int/certs" {
      capabilities = ["list"]
    }
  EOT
}

# Workload read-only policy — read secrets from designated paths, nothing else.
resource "vault_policy" "workload_read_only" {
  name = "workload-read-only"

  policy = <<-EOT
    # Workloads may only read from their designated secret paths.
    path "secret/data/workloads/*" {
      capabilities = ["read"]
    }
    path "secret/metadata/workloads/*" {
      capabilities = ["list"]
    }
    path "transit/decrypt/workload-key" {
      capabilities = ["update"]
    }
  EOT
}
