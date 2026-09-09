#!/usr/bin/env bash
# Shared, host-side helpers. Never source the reference project's .env.
set -euo pipefail
umask 077
VAULT_PROJECT_ROOT=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
VAULT_STATE="$VAULT_PROJECT_ROOT/.secrets/vault"
export VAULT_CACERT="$VAULT_PROJECT_ROOT/vault-tls/ca-chain.pem"
unset VAULT_SKIP_VERIFY VAULT_NAMESPACE VAULT_TOKEN VAULT_TLS_SERVER_NAME

vault_node() {
  case "$1" in
  vault-s) export VAULT_ADDR=https://127.0.0.1:18190 ;;
  vault-1) export VAULT_ADDR=https://127.0.0.1:18200 ;;
  vault-2) export VAULT_ADDR=https://127.0.0.1:18201 ;;
  vault-3) export VAULT_ADDR=https://127.0.0.1:18202 ;;
  *)
    echo "Unknown Vault node: $1" >&2
    return 1
    ;;
  esac
}

vault_json() {
  local code=0
  vault status -format=json || code=$?
  [ "$code" -eq 0 ] || [ "$code" -eq 2 ]
}

vault_wait() {
  local mode=$1 attempt state
  for ((attempt = 0; attempt < 60; attempt++)); do
    if state=$(vault_json 2>/dev/null); then
      if [ "$mode" = reachable ] || jq -e '.initialized and (.sealed | not)' <<<"$state" >/dev/null; then
        return 0
      fi
    fi
    sleep 2
  done
  echo "Timed out waiting for $VAULT_ADDR ($mode)." >&2
  return 1
}

vault_root() {
  local cluster=$1
  VAULT_TOKEN=$(jq -er '.root_token' "$VAULT_STATE/$cluster-init.json")
  export VAULT_TOKEN
}
