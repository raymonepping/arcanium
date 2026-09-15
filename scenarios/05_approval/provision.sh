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

# ── Authenticate if the stack requires it ─────────────────────────────────
# Same predates-auth gap as scenarios/01_onboarding/run.sh: this script's
# plain unauthenticated POST to /api/v1/applications 401s once
# ARCANIUM_AUTH_ENABLED=true. Prompt 29 — extracted into scenarios/lib/
# oidc_login.sh after this exact block was independently re-patched into
# two other scenario scripts the same day.
source "$ROOT_DIR/scenarios/lib/oidc_login.sh"
OIDC_LOGIN_TAG="approval-provision"
CURL_AUTH=()
if [ "$(auth_enabled "$ARCANIUM_API")" = "true" ]; then
  echo "[approval-provision] ARCANIUM_AUTH_ENABLED — signing in as demo-architect"
  oidc_login "demo-architect" "Arcanium-arch-2026" "$ARCANIUM_API" || exit 1
  trap 'rm -f "$OIDC_JAR"' EXIT
  CURL_AUTH=(-b "$OIDC_JAR")
fi

echo "[approval-provision] registering external-supplier in Arcanium API..."
APP_RESPONSE=$(curl -sf "${CURL_AUTH[@]}" -X POST "$ARCANIUM_API/api/v1/applications" \
  -H "Content-Type: application/json" \
  -d '{"name":"external-supplier","description":"Control Group demo workload"}' 2>/dev/null ||
  curl -sf "${CURL_AUTH[@]}" "$ARCANIUM_API/api/v1/applications" | python3 -c "import sys,json; apps=json.load(sys.stdin); [print(json.dumps(a)) for a in apps if a['name']=='external-supplier']" | head -1)

APP_ID=$(echo "$APP_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "[approval-provision] app_id: $APP_ID"

echo "[approval-provision] generating AppRole credentials..."
SUPPLIER_ROLE_ID=$(vault read -field=role_id auth/approle/role/external-supplier/role-id)
SUPPLIER_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/external-supplier/secret-id)
APPROVER_ROLE_ID=$(vault read -field=role_id auth/approle/role/approver-1/role-id)
APPROVER_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/approver-1/secret-id)

# Prompt 49 — found live: external-supplier's own POST /api/v1/approvals
# call has no Arcanium credential at all (a gap predating Prompt 18's real
# auth — worked only when ARCANIUM_AUTH_ENABLED=false, the default,
# because requireSession auto-grants an identity in that mode). Mint it
# the Prompt 28 service-account token this deployment already supports
# for exactly this machine-to-machine case. "operator" is the minimum
# role that satisfies POST /api/v1/approvals' authorize() check (its
# action defaults to destroy_request when the body's "encrypt" isn't in
# KNOWN_ACTION_MAP, and MATRIX grants operator unconditional
# destroy_request:true — no tenant/env scoping needed for this call).
echo "[approval-provision] provisioning external-supplier's Arcanium service-account token..."
SA_RESPONSE=$(curl -sf "${CURL_AUTH[@]}" -X POST "$ARCANIUM_API/api/v1/service-accounts" \
  -H "Content-Type: application/json" \
  -d '{"name":"external-supplier-workload","description":"external-supplier Control Group demo — POST /api/v1/approvals","roles":["operator"]}' 2>/dev/null ||
  curl -sf "${CURL_AUTH[@]}" "$ARCANIUM_API/api/v1/service-accounts" | python3 -c "import sys,json; accts=json.load(sys.stdin); [print(json.dumps(a)) for a in accts if a['name']=='external-supplier-workload']" | head -1)
SA_ID=$(echo "$SA_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
SA_TOKEN=$(curl -sf "${CURL_AUTH[@]}" -X POST "$ARCANIUM_API/api/v1/service-accounts/$SA_ID/tokens" \
  -H "Content-Type: application/json" \
  -d '{"description":"approval-provision.sh"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Append to .env.workloads (create if absent)
touch "$ROOT_DIR/.env.workloads"
# Remove any existing entries for these vars
sed -i '' '/^SUPPLIER_VAULT_ROLE_ID=/d;/^SUPPLIER_VAULT_SECRET_ID=/d;/^APPROVER_VAULT_ROLE_ID=/d;/^APPROVER_VAULT_SECRET_ID=/d;/^SUPPLIER_ARCANIUM_APP_ID=/d;/^SUPPLIER_ARCANIUM_TOKEN=/d' "$ROOT_DIR/.env.workloads" 2>/dev/null || true

cat >>"$ROOT_DIR/.env.workloads" <<EOF
SUPPLIER_VAULT_ROLE_ID=${SUPPLIER_ROLE_ID}
SUPPLIER_VAULT_SECRET_ID=${SUPPLIER_SECRET_ID}
APPROVER_VAULT_ROLE_ID=${APPROVER_ROLE_ID}
APPROVER_VAULT_SECRET_ID=${APPROVER_SECRET_ID}
SUPPLIER_ARCANIUM_APP_ID=${APP_ID}
SUPPLIER_ARCANIUM_TOKEN=${SA_TOKEN}
EOF

echo "[approval-provision] credentials appended to .env.workloads"
echo "[approval-provision] app_id=${APP_ID}"
