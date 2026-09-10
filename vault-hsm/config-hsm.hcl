ui            = true
disable_mlock = true
license_path  = "/vault/config/vault_v2_ent.hclic"

api_addr     = "https://vault-hsm:8200"
cluster_addr = "https://vault-hsm:8201"

listener "tcp" {
  address         = "0.0.0.0:8200"
  tls_cert_file   = "/vault/config/tls/vault.crt"
  tls_key_file    = "/vault/config/tls/vault.key"
  tls_min_version = "tls13"
}

# PKCS#11 auto-unseal via pkcs11-proxy → SoftHSM2
#
# Vault loads libpkcs11-proxy.so (injected into image at build time).
# The proxy library connects to softhsm-server:2345 over TLS-PSK,
# forwarding PKCS#11 calls to the SoftHSM2 daemon running there.
#
# This avoids the glibc/musl incompatibility: Vault never loads
# libsofthsm2.so directly.
#
# PKCS11_PROXY_SOCKET and PKCS11_PROXY_TLS_PSK_FILE are set as
# environment variables in compose/hsm/compose.yaml.
seal "pkcs11" {
  lib            = "/usr/local/lib/libpkcs11-proxy.so"
  slot           = "${SOFTHSM_SLOT_ID}"
  pin            = "${SOFTHSM_USER_PIN}"
  key_label      = "vault-hsm-wrap-key"
  hmac_key_label = "vault-hsm-hmac-key"
  generate_key   = "true"
}

# ── Managed Keys library (Prompt 14.1) ──────────────────────────────────────
# Registers the same pkcs11-proxy library for application key custody.
# A `sys/managed-keys/pkcs11/<name>` entry references this by `library = "softhsm-proxy"`.
# Vault delegates transit sign/verify for a `type = managed_key` key to SoftHSM
# over PKCS#11 — the private key is generated in and never leaves the token.
kms_library "pkcs11" {
  name    = "softhsm-proxy"
  library = "/usr/local/lib/libpkcs11-proxy.so"
}

storage "raft" {
  path    = "/vault/file"
  node_id = "vault-hsm"
}

log_level = "warn"

telemetry {
  prometheus_retention_time = "300s"
  disable_hostname          = true
}
