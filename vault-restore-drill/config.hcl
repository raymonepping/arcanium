ui = true
disable_mlock = true
license_path = "/vault/config/vault_v2.hclic"

api_addr     = "https://vault-restore-drill:8200"
cluster_addr = "https://vault-restore-drill:8201"

default_lease_ttl = "1h"
max_lease_ttl     = "168h"

# Same seal provider as the main cluster (vault-1/2/3, vault-1/config.hcl) —
# deliberate, not an accident: the Raft snapshot being restored here was
# sealed under vault-s's own transit key, so unsealing it requires that
# exact key, the same way recovering a real production cluster from
# snapshot would still need access to its own KMS/HSM. "Isolated" means
# isolated from the main 3-node cluster's Raft membership and compose
# project (this file's own compose.restore-drill.yaml, its own project
# name, its own fresh volume) — not isolated from the seal dependency
# every restore of this data would legitimately have.
seal "transit" {
  address     = "https://vault-s:8200"
  key_name    = "autounseal"
  mount_path  = "transit/"
  tls_ca_cert = "/vault/config/tls/ca-chain.pem"
}

listener "tcp" {
  address         = "0.0.0.0:8200"
  tls_cert_file   = "/vault/config/tls/vault.crt"
  tls_key_file    = "/vault/config/tls/vault.key"
  tls_min_version = "tls13"
}

storage "raft" {
  path    = "/vault/file"
  node_id = "vault-restore-drill"
  # No retry_join — single, standalone node. This is a restore target,
  # not a peer joining the main cluster's Raft membership.
}

log_level = "warn"
