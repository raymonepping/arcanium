#!/usr/bin/env bash
# scenarios/05_approval/approve.sh
# Approve the newest pending approval request:
#   1. Load approver-1 credentials from .env.workloads
#   2. Log in to Vault as approver-1 (member of crypto-approvers group)
#   3. Call sys/control-group/authorize with the accessor — approver's identity satisfies the CG factor
#   4. Call Arcanium API to record the approval in the DB
set -euo pipefail

ARCANIUM_API="${ARCANIUM_API:-http://localhost:3001}"
VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:18200}"
VAULT_CACERT="${VAULT_CACERT:-$(pwd)/vault-tls/ca-chain.pem}"

# Load approver credentials
if [ -f ".env.workloads" ]; then
  set -o allexport
  source .env.workloads
  set +o allexport
fi

ROLE_ID="${APPROVER_VAULT_ROLE_ID:-}"
SECRET_ID="${APPROVER_VAULT_SECRET_ID:-}"

if [ -z "$ROLE_ID" ] || [ -z "$SECRET_ID" ]; then
  echo "[approve] ERROR: APPROVER_VAULT_ROLE_ID / APPROVER_VAULT_SECRET_ID not set."
  echo "         Run: make approval-provision"
  exit 1
fi

# Get newest pending approval from Arcanium API
PENDING=$(curl -sf "$ARCANIUM_API/api/v1/approvals")
COUNT=$(echo "$PENDING" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")

if [ "$COUNT" = "0" ]; then
  echo "[approve] No pending approvals."
  exit 0
fi

# Sort by created_at descending — pick newest
FIRST_ID="${APPROVAL_ID:-$(echo "$PENDING" | python3 -c "
import sys,json
rows = sorted(json.load(sys.stdin), key=lambda r: r['created_at'], reverse=True)
print(rows[0]['id'])")}"
ACCESSOR=$(echo "$PENDING" | python3 -c "
import sys,json
rows = json.load(sys.stdin)
r = next((x for x in rows if x['id'] == '$FIRST_ID'), rows[0])
print(r.get('accessor') or '')")

echo "[approve] Pending: id=$FIRST_ID  accessor=$ACCESSOR"

# Step 1: log in as approver-1 to get a token with crypto-approver-policy
APPROVER_TOKEN=$(curl -sf \
  --cacert "$VAULT_CACERT" \
  -X POST "$VAULT_ADDR/v1/auth/approle/login" \
  -H "Content-Type: application/json" \
  -d "{\"role_id\":\"$ROLE_ID\",\"secret_id\":\"$SECRET_ID\"}" |
  python3 -c "import sys,json; print(json.load(sys.stdin)['auth']['client_token'])")
echo "[approve] approver-1 token acquired"

# Step 2: authorize the Control Group request using the approver's identity
# The approver-1 entity is a member of crypto-approvers — this satisfies the CG factor.
if [ -n "$ACCESSOR" ]; then
  CG_RESULT=$(curl -sf \
    --cacert "$VAULT_CACERT" \
    -X POST "$VAULT_ADDR/v1/sys/control-group/authorize" \
    -H "Content-Type: application/json" \
    -H "X-Vault-Token: $APPROVER_TOKEN" \
    -d "{\"accessor\":\"$ACCESSOR\"}")
  echo "[approve] Vault CG authorize: $CG_RESULT"
else
  echo "[approve] No accessor — skipping Vault CG authorize (non-CG record)"
fi

# Step 3: record the approval in Arcanium API (updates DB status → 'approved')
RESULT=$(curl -sf -X POST "$ARCANIUM_API/api/v1/approvals/$FIRST_ID/approve" \
  -H "Content-Type: application/json")
echo "[approve] Arcanium API result: $RESULT"
