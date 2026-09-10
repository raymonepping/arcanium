#!/bin/sh
# scripts/vault-check-entitlement.sh — Prompt 14.3 / 14.4
# Prints the Vault Enterprise licence features and whether a named feature is
# present. Exit 0 if present, 1 if not.
#
# Usage:
#   ./scripts/vault-check-entitlement.sh                 # list all features
#   ./scripts/vault-check-entitlement.sh "Sentinel"      # test one feature
#   ./scripts/vault-check-entitlement.sh "Key Management Secrets Engine"

set -eu

REPO_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
ROOT_TOKEN=$(python3 -c "import json;print(json.load(open('$REPO_ROOT/.secrets/vault/cluster-init.json'))['root_token'])")

FEATURES=$(podman exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_SKIP_VERIFY=1 \
  -e VAULT_TOKEN="$ROOT_TOKEN" arcanium-vault_1 \
  vault read -format=json sys/license/status 2>/dev/null |
  python3 -c "import sys,json;print('\n'.join(json.load(sys.stdin)['data']['autoloaded']['features']))")

if [ "$#" -eq 0 ]; then
  echo "$FEATURES"
  exit 0
fi

if echo "$FEATURES" | grep -qxF "$1"; then
  echo "✓ entitled: $1"
  exit 0
else
  echo "✗ NOT entitled: $1"
  exit 1
fi
