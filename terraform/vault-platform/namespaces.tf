# ── Vault namespace — arcanium (Enterprise) ──────────────────────────────────
# Creates an organisational namespace boundary for all Arcanium-owned secrets,
# auth bindings and policies. Workloads live in the root namespace or their own.

resource "vault_namespace" "arcanium" {
  path = "arcanium"
}
