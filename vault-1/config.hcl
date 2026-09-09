ui = true
disable_mlock = true
license_path = "/vault/config/vault_v2.hclic"

api_addr     = "https://vault-1:8200"
cluster_addr = "https://vault-1:8201"

default_lease_ttl = "1h"
max_lease_ttl     = "168h"
cache_size        = 32000

# Primary auto-unseal — vault-s transit engine.
# Token loaded from the Arcanium-only secret file by vault-server.sh.
seal "transit" {
  address     = "https://vault-s:8200"
  key_name    = "autounseal"
  mount_path  = "transit/"
  tls_ca_cert = "/vault/config/tls/ca-chain.pem"
}

listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_cert_file = "/vault/config/tls/vault.crt"
  tls_key_file  = "/vault/config/tls/vault.key"
  tls_min_version = "tls13"

}

storage "raft" {
  path    = "/vault/file"
  node_id = "vault-1"

  # Raft performance tuning
  performance_multiplier = 5
  trailing_logs          = 10000  # log entries to keep beyond the last snapshot
  snapshot_interval      = "30s"  # compact Raft log every 30s (default 2m)
  snapshot_threshold     = 8192   # also snapshot after this many uncommitted entries

  retry_join {
    leader_api_addr     = "https://vault-2:8200"
    leader_ca_cert_file = "/vault/config/tls/ca-chain.pem"
  }
  retry_join {
    leader_api_addr     = "https://vault-3:8200"
    leader_ca_cert_file = "/vault/config/tls/ca-chain.pem"
  }
}

log_level = "warn"

telemetry {
  prometheus_retention_time = "300s"
  disable_hostname          = true
}
