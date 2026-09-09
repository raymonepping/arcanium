# ── Audit devices ─────────────────────────────────────────────────────────────
# The bootstrap script enables audit during first-time init. This resource is
# declared idempotently — Terraform will adopt the existing device on import
# and will re-enable it if it is ever removed.

resource "vault_audit" "file" {
  type = "file"
  path = "primary"

  options = {
    file_path = "/vault/audit/vault-audit.log"
  }
}
