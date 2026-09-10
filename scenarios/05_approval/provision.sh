#!/usr/bin/env bash
# scenarios/05_approval/provision.sh
# Registers the external-supplier application in Arcanium API,
# generates AppRole credentials for external-supplier + approver-1,
# and appends them to .env.workloads.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT="$ROOT_DIR/vault-tls/ca-chain.pem"
export VAULT_TOKEN=$(python3 -c "import sys,json; print(json.load(open('$ROOT_DIR/.secrets/vault/cluster-init.json'))['root_token'])")

ARCANIUM_API="${ARCANIUM_API:-http://localhost:3001}"

echo "[approval-provision] registering external-supplier in Arcanium API..."
APP_RESPONSE=$(curl -sf -X POST "$ARCANIUM_API/api/v1/applications" \
  -H "Content-Type: application/json" \
  -d '{"name":"external-supplier","description":"Control Group demo workload"}' 2>/dev/null ||
  curl -sf "$ARCANIUM_API/api/v1/applications" | python3 -c "import sys,json; apps=json.load(sys.stdin); [print(json.dumps(a)) for a in apps if a['name']=='external-supplier']" | head -1)

APP_ID=$(echo "$APP_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "[approval-provision] app_id: $APP_ID"

echo "[approval-provision] generating AppRole credentials..."
SUPPLIER_ROLE_ID=$(vault read -field=role_id auth/approle/role/external-supplier/role-id)
SUPPLIER_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/external-supplier/secret-id)
APPROVER_ROLE_ID=$(vault read -field=role_id auth/approle/role/approver-1/role-id)
APPROVER_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/approver-1/secret-id)

# Append to .env.workloads (create if absent)
touch "$ROOT_DIR/.env.workloads"
# Remove any existing entries for these vars
sed -i '' '/^SUPPLIER_VAULT_ROLE_ID=/d;/^SUPPLIER_VAULT_SECRET_ID=/d;/^APPROVER_VAULT_ROLE_ID=/d;/^APPROVER_VAULT_SECRET_ID=/d;/^SUPPLIER_ARCANIUM_APP_ID=/d' "$ROOT_DIR/.env.workloads" 2>/dev/null || true

cat >>"$ROOT_DIR/.env.workloads" <<EOF
SUPPLIER_VAULT_ROLE_ID=${SUPPLIER_ROLE_ID}
SUPPLIER_VAULT_SECRET_ID=${SUPPLIER_SECRET_ID}
APPROVER_VAULT_ROLE_ID=${APPROVER_ROLE_ID}
APPROVER_VAULT_SECRET_ID=${APPROVER_SECRET_ID}
SUPPLIER_ARCANIUM_APP_ID=${APP_ID}
EOF

echo "[approval-provision] credentials appended to .env.workloads"
echo "[approval-provision] app_id=${APP_ID}"
