#!/usr/bin/env bash
# scripts/verify-stack.sh
# ---------------------------------------------------------------------------
# Arcanium stack verification — exercises every exposed API route and workload
# health endpoint. Intended as a post-start smoke test and traceability check.
#
# Usage:
#   ./scripts/verify-stack.sh             # full check
#   ./scripts/verify-stack.sh --no-vault  # skip Vault cluster checks (no token needed)
#
# Exit code: 0 if all checks pass, 1 if any fail.
# ---------------------------------------------------------------------------
set -uo pipefail

# ── Colours ─────────────────────────────────────────────────────────────────
GRN='\033[0;32m'
RED='\033[0;31m'
YLW='\033[0;33m'
BLD='\033[1m'
RST='\033[0m'

# ── Config (override via env) ────────────────────────────────────────────────
API="${ARCANIUM_API:-http://localhost:3001}"
VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:18200}"
VAULT_CACERT="${VAULT_CACERT:-$(cd "$(dirname "$0")/.." && pwd)/vault-tls/ca-chain.pem}"
SECRETS_DIR="${SECRETS_DIR:-$(cd "$(dirname "$0")/.." && pwd)/.secrets/vault}"
SKIP_VAULT=false
[[ "${1:-}" == "--no-vault" ]] && SKIP_VAULT=true

# ── State ────────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
WARN=0
APP_ID=""
SUPPLIER_ID=""

# ── Helpers ──────────────────────────────────────────────────────────────────
pass() {
  echo -e "  ${GRN}✓${RST}  $*"
  ((PASS++))
}
fail() {
  echo -e "  ${RED}✗${RST}  $*"
  ((FAIL++))
}
warn() {
  echo -e "  ${YLW}~${RST}  $*"
  ((WARN++))
}
section() { echo -e "\n${BLD}▸ $*${RST}"; }
hr() { echo "  ──────────────────────────────────────────────"; }

# Check HTTP status + optional jq expression.
# check <label> <expected_status> <url> [method] [body] [jq_expr]
check() {
  local label="$1" expected="$2" url="$3"
  local method="${4:-GET}" body="${5:-}" jq_expr="${6:-}"
  # Use -s (silent) not -sf (-f exits non-zero on 4xx/5xx which we want to capture)
  local args=(-s -o /tmp/arc_verify_body -w "%{http_code}" --max-time 8)
  [[ "$method" != "GET" ]] && args+=(-X "$method")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" -d "$body")

  local status
  status=$(curl "${args[@]}" "$url" 2>/dev/null) || status="000"
  local body_text
  body_text=$(cat /tmp/arc_verify_body 2>/dev/null || echo "")

  if [[ "$status" != "$expected" ]]; then
    fail "$label  [expected $expected, got $status]  ${body_text:0:120}"
    return
  fi

  if [[ -n "$jq_expr" ]]; then
    local result
    result=$(echo "$body_text" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    # evaluate simple jq-like expressions
    expr = '''$jq_expr'''
    if expr.startswith('.'):
        parts = expr.lstrip('.').split('.')
        v = d
        for p in parts:
            if isinstance(v, list) and p.isdigit():
                v = v[int(p)]
            elif isinstance(v, dict):
                v = v.get(p)
            else:
                v = None
        print(str(v))
    else:
        print(str(d))
except Exception as e:
    print(f'jq_err: {e}')
" 2>/dev/null || echo "parse_err")
    pass "$label  ${YLW}→ ${result}${RST}"
  else
    pass "$label"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BLD}╔══════════════════════════════════════════════════════╗${RST}"
echo -e "${BLD}║        Arcanium Stack Verification                   ║${RST}"
echo -e "${BLD}╚══════════════════════════════════════════════════════╝${RST}"
echo -e "  API:        $API"
echo -e "  Vault:      $VAULT_ADDR"
echo -e "  Timestamp:  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── 1. Health endpoints ───────────────────────────────────────────────────────
section "1. Arcanium API — Health"
check "GET /health/live" 200 "$API/health/live" GET "" ".status"
check "GET /health/ready" 200 "$API/health/ready" GET "" ".status"
check "GET /health" 200 "$API/health" GET "" ".status"

# Extract version from health for display
VERSION=$(curl -sf --max-time 5 "$API/health" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "?")
echo -e "     ${YLW}API version: $VERSION${RST}"

# ── 2. Applications ────────────────────────────────────────────────────────────
section "2. Applications"
check "GET  /api/v1/applications" 200 "$API/api/v1/applications" GET "" ".0.name"

# Pick an existing app_id for detail/patch tests
APP_ID=$(curl -sf --max-time 5 "$API/api/v1/applications" 2>/dev/null |
  python3 -c "import sys,json; apps=json.load(sys.stdin); print(apps[0]['id'] if apps else '')" 2>/dev/null || echo "")

if [[ -n "$APP_ID" ]]; then
  check "GET  /api/v1/applications/:id" 200 "$API/api/v1/applications/$APP_ID" GET "" ".name"
  check "GET  /api/v1/applications/:id (profiles)" 200 "$API/api/v1/applications/$APP_ID" GET "" ".crypto_profiles"
  check "PATCH /api/v1/applications/:id" 200 "$API/api/v1/applications/$APP_ID" \
    PATCH '{"description":"verified by verify-stack.sh"}' ".description"
else
  warn "No applications registered — skipping detail/patch checks"
fi

# POST + DELETE lifecycle (ephemeral test app)
TEST_APP=$(curl -sf --max-time 5 -X POST "$API/api/v1/applications" \
  -H "Content-Type: application/json" \
  -d '{"name":"verify-stack-test-app","description":"ephemeral smoke test"}' 2>/dev/null |
  python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

if [[ -n "$TEST_APP" ]]; then
  pass "POST /api/v1/applications  → $TEST_APP"
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 \
    -X DELETE "$API/api/v1/applications/$TEST_APP" 2>/dev/null || echo "000")
  if [[ "$STATUS" == "204" ]]; then pass "DELETE /api/v1/applications/:id"; else fail "DELETE /api/v1/applications/:id  [got $STATUS]"; fi
else
  warn "Could not create ephemeral test app (409 name conflict is OK)"
fi

# 409 on duplicate name (use -s not -sf so 4xx doesn't cause non-zero exit)
DUPE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "$API/api/v1/applications" \
  -H "Content-Type: application/json" \
  -d '{"name":"payments-api"}' 2>/dev/null || echo "000")
[[ "$DUPE" == "409" ]] && pass "POST /api/v1/applications 409 on duplicate name" ||
  warn "POST duplicate name returned $DUPE (expected 409)"

# ── 3. Transit Keys ─────────────────────────────────────────────────────────
section "3. Transit Keys"
check "GET  /api/v1/keys" 200 "$API/api/v1/keys" GET "" ".0.name"
check "GET  /api/v1/keys/payments-api-key" 200 "$API/api/v1/keys/payments-api-key" GET "" ".name"
check "GET  /api/v1/keys/external-supplier-key" 200 "$API/api/v1/keys/external-supplier-key" GET "" ".type"
check "GET  /api/v1/keys/document-signing-key" 200 "$API/api/v1/keys/document-signing-key" GET "" ".name"
check "GET  /api/v1/keys/:name 404" 404 "$API/api/v1/keys/nonexistent-key-xyz" GET

# ── 4. PKI ──────────────────────────────────────────────────────────────────
section "4. PKI"
check "GET  /api/v1/pki/ca-chain" 200 "$API/api/v1/pki/ca-chain"
CA_BODY=$(cat /tmp/arc_verify_body 2>/dev/null || echo "")
[[ "$CA_BODY" == *"BEGIN CERTIFICATE"* ]] && pass "PKI ca-chain contains PEM certificate" ||
  fail "PKI ca-chain missing PEM content"
check "GET  /api/v1/pki/roles" 200 "$API/api/v1/pki/roles"

# ── 5. Suppliers ─────────────────────────────────────────────────────────────
section "5. Suppliers"
check "GET  /api/v1/suppliers" 200 "$API/api/v1/suppliers" GET "" ".0.name"

SUPPLIER_ID=$(curl -sf --max-time 5 "$API/api/v1/suppliers" 2>/dev/null |
  python3 -c "import sys,json; s=json.load(sys.stdin); print(s[0]['id'] if s else '')" 2>/dev/null || echo "")

if [[ -n "$SUPPLIER_ID" ]]; then
  check "GET  /api/v1/suppliers/:id" 200 "$API/api/v1/suppliers/$SUPPLIER_ID" GET "" ".name"
  check "GET  /api/v1/suppliers/:id/applications" 200 "$API/api/v1/suppliers/$SUPPLIER_ID/applications" GET "" ""
  check "GET  /api/v1/suppliers/:id/keys" 200 "$API/api/v1/suppliers/$SUPPLIER_ID/keys" GET "" ""
else
  warn "No suppliers registered — skipping supplier detail checks"
fi

# ── 6. Approvals ─────────────────────────────────────────────────────────────
section "6. Approvals"
check "GET  /api/v1/approvals (pending)" 200 "$API/api/v1/approvals" GET "" ""
check "GET  /api/v1/approvals?all=true" 200 "$API/api/v1/approvals?all=true" GET "" ""

# Count pending / approved / rejected
APPROVAL_SUMMARY=$(curl -sf --max-time 5 "$API/api/v1/approvals?all=true" 2>/dev/null |
  python3 -c "
import sys,json
rows=json.load(sys.stdin)
by_status={}
for r in rows:
    s=r['status']; by_status[s]=by_status.get(s,0)+1
parts=[f\"{s}={n}\" for s,n in sorted(by_status.items())]
print(', '.join(parts) or 'empty')
" 2>/dev/null || echo "parse error")
echo -e "     ${YLW}Approval breakdown: $APPROVAL_SUMMARY${RST}"

# Fetch the newest pending approval for traceability
NEWEST_PENDING=$(curl -sf --max-time 5 "$API/api/v1/approvals" 2>/dev/null |
  python3 -c "
import sys,json
rows=sorted(json.load(sys.stdin), key=lambda r: r['created_at'], reverse=True)
if rows: print(rows[0]['id']+' acc='+str(rows[0].get('accessor','none'))[:28])
else: print('none')
" 2>/dev/null || echo "none")
echo -e "     ${YLW}Newest pending: $NEWEST_PENDING${RST}"

# ── 7. Workload health endpoints ──────────────────────────────────────────────
section "7. Workload Health Endpoints"
check "payments-api    :3002/health" 200 "http://localhost:3002/health" GET "" ".status"
check "pki-client      :3003/health" 200 "http://localhost:3003/health" GET "" ".status"
check "kmip-client     :3007/health" 200 "http://localhost:3007/health" GET "" ".status"
check "external-supplier :3005/health" 200 "http://localhost:3005/health" GET "" ".status"
DOC_STATUS=$(curl -sf -o /tmp/arc_verify_body -w "%{http_code}" --max-time 5 "http://localhost:3006/health" 2>/dev/null || echo "000")
if [[ "$DOC_STATUS" == "200" ]]; then
  pass "document-signing  :3006/health"
else
  warn "document-signing :3006 not reachable (port not published — ok if no host mapping)"
fi

# pki-client cert detail
CERT_INFO=$(curl -sf --max-time 5 "http://localhost:3003/cert" 2>/dev/null |
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"serial={str(d.get('serial','?'))[:20]} expires={d.get('expiresAt','?')[:19]}\")" \
    2>/dev/null || echo "unavailable")
echo -e "     ${YLW}pki-client cert: $CERT_INFO${RST}"

# payments-api key version
PAYMENTS_INFO=$(curl -sf --max-time 5 "http://localhost:3002/health" 2>/dev/null |
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"key={d.get('transitKey','?')} v{d.get('keyVersion','?')}\")" \
    2>/dev/null || echo "unavailable")
echo -e "     ${YLW}payments-api:    $PAYMENTS_INFO${RST}"

# ── 8. Vault cluster ──────────────────────────────────────────────────────────
section "8. Vault Cluster"

if $SKIP_VAULT; then
  warn "Vault checks skipped (--no-vault)"
else
  for node_port in "vault-s:18190" "vault-1:18200" "vault-2:18201" "vault-3:18202"; do
    node="${node_port%%:*}"
    port="${node_port##*:}"
    STATUS_JSON=$(curl -sk --max-time 5 \
      "https://127.0.0.1:${port}/v1/sys/health?standbyok=true&sealedok=true&uninitok=false" \
      2>/dev/null || echo "{}")
    VERSION=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "?")
    SEALED=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sealed','?'))" 2>/dev/null || echo "?")
    STANDBY=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('standby','?'))" 2>/dev/null || echo "?")
    HA=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ha_enabled','?'))" 2>/dev/null || echo "?")

    if [[ "$VERSION" == "?" ]]; then
      fail "$node  :$port  unreachable"
    elif [[ "$SEALED" == "True" ]] || [[ "$SEALED" == "true" ]]; then
      fail "$node  :$port  SEALED  version=$VERSION"
    else
      ROLE="active"
      [[ "$STANDBY" == "True" || "$STANDBY" == "true" ]] && ROLE="standby"
      pass "$node  :$port  $ROLE  version=$VERSION  ha=$HA"
    fi
  done

  # vault-hsm (seal provider)
  HSM_JSON=$(curl -sk --max-time 5 \
    "https://127.0.0.1:18300/v1/sys/health?standbyok=true&sealedok=true&uninitok=false" \
    2>/dev/null || echo "{}")
  HSM_VER=$(echo "$HSM_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "?")
  HSM_SEALED=$(echo "$HSM_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sealed','?'))" 2>/dev/null || echo "?")
  if [[ "$HSM_VER" == "?" ]]; then
    fail "vault-hsm :18300  unreachable"
  elif [[ "$HSM_SEALED" == "True" || "$HSM_SEALED" == "true" ]]; then
    fail "vault-hsm :18300  SEALED"
  else
    pass "vault-hsm :18300  version=$HSM_VER  (transit auto-unseal provider)"
  fi

  # Vault license
  TOKEN_FILE="$SECRETS_DIR/cluster-init.json"
  if [[ -f "$TOKEN_FILE" ]]; then
    VAULT_TOKEN_VAL=$(python3 -c "import json; print(json.load(open('$TOKEN_FILE'))['root_token'])" 2>/dev/null || echo "")
    if [[ -n "$VAULT_TOKEN_VAL" ]]; then
      LIC_JSON=$(curl -sk --max-time 5 \
        -H "X-Vault-Token: $VAULT_TOKEN_VAL" \
        "https://127.0.0.1:18200/v1/sys/license/status" \
        --cacert "$VAULT_CACERT" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
ld=d.get('data',{}).get('autoloaded',d.get('data',{}))
print(ld.get('expiration_time','?')[:10])
" 2>/dev/null || echo "?")
      CG=$(curl -sk --max-time 5 \
        -H "X-Vault-Token: $VAULT_TOKEN_VAL" \
        "https://127.0.0.1:18200/v1/sys/license/status" \
        --cacert "$VAULT_CACERT" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
feat=str(d)
print('YES' if 'Control Groups' in feat else 'NO')
" 2>/dev/null || echo "?")
      pass "Vault license  expiry=$LIC_JSON  control_groups=$CG"
    else
      warn "Could not read root token from $TOKEN_FILE"
    fi
  else
    warn "No cluster-init.json found — skipping license check"
  fi

  # Cluster membership
  if [[ -n "${VAULT_TOKEN_VAL:-}" ]]; then
    MEMBERS=$(curl -sk --max-time 5 \
      -H "X-Vault-Token: $VAULT_TOKEN_VAL" \
      "https://127.0.0.1:18200/v1/sys/storage/raft/autopilot/state" \
      --cacert "$VAULT_CACERT" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
servers=d.get('data',{}).get('servers',{})
lines=[]
for name,info in servers.items():
    lines.append(f'{name} status={info.get(\"status\",\"?\")} leader={info.get(\"leader\",False)}')
print(' | '.join(lines) or 'unavailable')
" 2>/dev/null || echo "unavailable")
    echo -e "     ${YLW}Raft members: $MEMBERS${RST}"
  fi
fi

# ── 9. Container health (Podman) ───────────────────────────────────────────────
section "9. Container Status (podman ps)"
CONTAINERS=(
  "arcanium-postgres"
  "arcanium-softhsm_server"
  "arcanium-vault_hsm"
  "arcanium-vault_s"
  "arcanium-vault_1"
  "arcanium-vault_2"
  "arcanium-vault_3"
  "arcanium-api"
  "arcanium-payments-api"
  "arcanium-pki-client"
  "arcanium-kmip-client"
  "arcanium-document-signing"
  "arcanium-external-supplier"
)
for cname in "${CONTAINERS[@]}"; do
  STATUS=$(podman inspect "$cname" --format '{{.State.Status}}' 2>/dev/null || echo "missing")
  HEALTH=$(podman inspect "$cname" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")
  if [[ "$STATUS" == "running" ]]; then
    DETAIL="running"
    [[ -n "$HEALTH" && "$HEALTH" != "<no value>" ]] && DETAIL="$STATUS ($HEALTH)"
    if [[ "$HEALTH" == "unhealthy" ]]; then
      fail "$cname  $DETAIL"
    else
      pass "$cname  $DETAIL"
    fi
  else
    fail "$cname  status=$STATUS"
  fi
done

# ── 10. 4xx / error contract spot-checks ──────────────────────────────────────
section "10. Error Contract"
check "GET  /api/v1/applications/bad-uuid  → 400" 400 "$API/api/v1/applications/not-a-uuid"
check "GET  /api/v1/applications/unknown   → 404" 404 "$API/api/v1/applications/00000000-0000-0000-0000-000000000000"
check "GET  /api/v1/keys/nonexistent       → 404" 404 "$API/api/v1/keys/no-such-key"
check "GET  /unknown-route                 → 404" 404 "$API/totally-unknown-route"
check "POST /api/v1/applications (no name) → 400" 400 "$API/api/v1/applications" POST '{}'

# ── Summary ───────────────────────────────────────────────────────────────────
hr
TOTAL=$((PASS + FAIL + WARN))
echo ""
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GRN}${BLD}  ✓ All checks passed${RST}  (${PASS} pass, ${WARN} warn, ${FAIL} fail / ${TOTAL} total)"
else
  echo -e "${RED}${BLD}  ✗ Some checks failed${RST}  (${PASS} pass, ${WARN} warn, ${FAIL} fail / ${TOTAL} total)"
fi
echo ""

[[ $FAIL -eq 0 ]]
