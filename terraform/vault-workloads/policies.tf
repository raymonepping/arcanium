# ── Workload policies ─────────────────────────────────────────────────────
# Scoped to specific keys only — least-privilege per workload.

# payments-api: encrypt + decrypt + rewrap + rotate on payments-api-key only.
resource "vault_policy" "payments_api" {
  name = "payments-api-policy"

  policy = <<-EOT
    path "transit/encrypt/payments-api-key" {
      capabilities = ["update"]
    }
    path "transit/decrypt/payments-api-key" {
      capabilities = ["update"]
    }
    path "transit/rewrap/payments-api-key" {
      capabilities = ["update"]
    }
    path "transit/keys/payments-api-key/rotate" {
      capabilities = ["update"]
    }
    path "transit/keys/payments-api-key" {
      capabilities = ["read"]
    }
  EOT
}

# pki-client: issue certificates from the arcanium-services role only.
resource "vault_policy" "pki_client" {
  name = "pki-client-policy"

  policy = <<-EOT
    path "pki-int/issue/arcanium-services" {
      capabilities = ["create", "update"]
    }
    path "pki-int/cert/*" {
      capabilities = ["read"]
    }
  EOT
}

# document-signing: sign + verify + rotate on document-signing-key only.
resource "vault_policy" "document_signing" {
  name = "document-signing-policy"

  policy = <<-EOT
    path "transit/sign/document-signing-key" {
      capabilities = ["update"]
    }
    path "transit/verify/document-signing-key" {
      capabilities = ["update"]
    }
    path "transit/keys/document-signing-key/rotate" {
      capabilities = ["update"]
    }
    path "transit/keys/document-signing-key" {
      capabilities = ["read"]
    }
  EOT
}
