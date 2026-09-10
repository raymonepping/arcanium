# Rate-limit quotas — namespace-scoped quotas applied at root level.
# Vault quota path format: "namespace-path/" (with trailing slash).
# Must be created AFTER the namespaces exist.

resource "vault_quota_rate_limit" "pepsi_sla" {
  name           = "pepsi-sla"
  path           = "suppliers/pepsi/"
  rate           = var.sla_rate_per_minute
  interval       = 60
  block_interval = 300

  depends_on = [vault_namespace.pepsi]
}

resource "vault_quota_rate_limit" "cocacola_sla" {
  name           = "cocacola-sla"
  path           = "suppliers/cocacola/"
  rate           = var.sla_rate_per_minute
  interval       = 60
  block_interval = 300

  depends_on = [vault_namespace.cocacola]
}
