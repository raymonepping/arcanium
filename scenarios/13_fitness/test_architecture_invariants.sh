#!/usr/bin/env bash
# scenarios/13_fitness/test_architecture_invariants.sh — Prompt 22,
# Deliverable 4. Architectural invariants become executable tests, not
# README prose — "the UI must never import a Vault client" fails a CI job
# if violated, not just a documented rule (input/32).
#
# Every check here reports a real finding, live against the actual repo —
# never a static count assumed once and hard-coded. A gap found here has
# historically been a real bug (see scenarios/11_security_foundation's own
# "Prompt 19/22" sections, all found by running checks exactly like these,
# not by review) — never quietly narrow a check to make it pass instead of
# fixing what it found.
set -uo pipefail
cd "$(dirname -- "$0")/../.." # -> repo root
set -a
[ -f .env ] && . ./.env
set +a

API="${ARCANIUM_API:-http://localhost:3001}"

PASS=0
FAIL=0
UNKNOWN=0
ok() {
  echo "  ✓ $1"
  PASS=$((PASS + 1))
}
bad() {
  echo "  ✗ $1"
  FAIL=$((FAIL + 1))
}
unk() {
  echo "  ? $1 (skipped — see reason)"
  UNKNOWN=$((UNKNOWN + 1))
}

echo "== Prompt 22 — Architecture Fitness Tests =="
echo

# ── 1 — ui/ contains no direct Vault client import ──────────────────────
HITS=$(grep -rl "node-vault\|from ['\"]vault['\"]\|require(['\"]vault['\"]\|X-Vault-Token\|VAULT_ADDR" \
  arcanium/ui/app arcanium/ui/server 2>/dev/null | grep -v '\.test\.' || true)
if [ -z "$HITS" ]; then
  ok "ui/ contains no direct Vault client import or Vault API usage"
else
  bad "ui/ references Vault directly: $HITS"
fi

# ── 2 — no VAULT_TOKEN / VAULT_ROLE_ID / VAULT_SECRET_ID literal under ui/ ──
HITS=$(grep -rl "VAULT_TOKEN\|VAULT_ROLE_ID\|VAULT_SECRET_ID" \
  arcanium/ui/app arcanium/ui/server 2>/dev/null || true)
if [ -z "$HITS" ]; then
  ok "no VAULT_TOKEN/VAULT_ROLE_ID/VAULT_SECRET_ID literal appears anywhere under ui/"
else
  bad "Vault credential env var literal found under ui/: $HITS"
fi

# ── 3 — no OIDC token key in the ui/ CLIENT bundle output ───────────────
# Server-side code (ui/server, incl. the OIDC relay routes) legitimately
# handles these; only the CLIENT (browser) bundle under .output/public must
# never carry them — the whole point of Phase 18's confidential-client
# design (Express is the OIDC client end-to-end, never Nuxt/the browser).
if [ -d arcanium/ui/.output/public ]; then
  HITS=$(grep -rl "access_token\|id_token\|refresh_token" arcanium/ui/.output/public 2>/dev/null || true)
  if [ -z "$HITS" ]; then
    ok "no OIDC access/id/refresh token key appears in the built ui/ client bundle"
  else
    bad "OIDC token key found in the client bundle: $HITS"
  fi
else
  unk "ui/ client-bundle check — arcanium/ui/.output/public not built yet (run npm run build / make arcanium-ui-build first)"
fi

# ── 4 — every gateway write-allowlist route has an openapi.yaml entry ───
GATEWAY_FILE="arcanium/ui/server/routes/gateway/[...path].ts"
OPENAPI_FILE="openapi/arcanium.yaml"
if [ -f "$GATEWAY_FILE" ] && [ -f "$OPENAPI_FILE" ]; then
  # Resource words the gateway's read/write regexes reference — checked
  # against the regex text itself (grep -o), not hand-copied, so this
  # drifts with the gateway file, not silently out of sync with it.
  RESOURCES=$(grep -oE 'api\\/v1\\/\([a-z|]+\)' "$GATEWAY_FILE" | head -1 |
    sed -E 's/.*\(([a-z|]+)\)/\1/' | tr '|' '\n' | sort -u)
  MISSING=""
  for r in $RESOURCES; do
    grep -q "^  /api/v1/${r}" "$OPENAPI_FILE" || MISSING="$MISSING $r"
  done
  if [ -z "$MISSING" ]; then
    ok "every gateway allowlist resource word has at least one /api/v1/<word>... entry in openapi/arcanium.yaml"
  else
    bad "gateway allowlist references resource(s) missing from openapi/arcanium.yaml:$MISSING"
  fi
else
  unk "gateway/openapi coverage check — $GATEWAY_FILE or $OPENAPI_FILE not found"
fi

# ── 5 — every mutating route calls authorize() ───────────────────────────
if node scenarios/13_fitness/check_authorize_coverage.mjs; then
  ok "every mutating route in arcanium/api/src/routes/*.js calls authorize()"
else
  bad "one or more mutating routes never reach authorize() — see output above"
fi

# ── 6 — no tenant-relevant row queried without a tenant-scope predicate ──
if node scenarios/13_fitness/check_tenant_scope_coverage.mjs; then
  ok "every tenant-relevant GET route calls tenantScope() (directly or via a documented helper)"
else
  bad "one or more GET routes query a tenant table without tenantScope() — see output above"
fi

# ── 7 — EXCEPTION_ACCEPTED never appears as a status/observation_status
# value — that belongs to disposition only (input/36's two-axis correction,
# a real design mistake an earlier draft of Prompt 20 made and had to be
# corrected before Prompt 20 was even executed) ──────────────────────────
oidc_login() {
  local user="$1" jar="$2" pass="$3"
  : >"$jar"
  local login_headers auth_url form_html form_action cb_headers cb_url qs
  login_headers=$(curl -sD - -o /dev/null -c "$jar" "$API/api/v1/auth/login?next=/")
  auth_url=$(echo "$login_headers" | grep -i '^location:' | awk '{print $2}' | tr -d '\r\n')
  [ -z "$auth_url" ] && return 1
  form_html=$(curl -s -c "$jar" -b "$jar" "$auth_url")
  form_action=$(echo "$form_html" | grep -oE 'action="[^"]*"' | head -1 |
    sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
  [ -z "$form_action" ] && return 1
  cb_headers=$(curl -sD - -o /dev/null -c "$jar" -b "$jar" \
    --data-urlencode "username=$user" --data-urlencode "password=$pass" \
    "$form_action")
  cb_url=$(echo "$cb_headers" | grep -i '^location:' | awk '{print $2}' | tr -d '\r\n')
  [ -z "$cb_url" ] && return 1
  case "$cb_url" in *auth/callback*) ;; *) return 1 ;; esac
  qs="${cb_url#*\?}"
  curl -s -o /dev/null -c "$jar" -b "$jar" "$API/api/v1/auth/callback?$qs"
  grep -q arc_session "$jar" 2>/dev/null
}

STACK_UP=false
if curl -fsS --max-time 3 "${ARCANIUM_OIDC_PUBLIC_URL:-http://localhost:8083}/realms/arcanium" >/dev/null 2>&1 &&
  curl -fsS --max-time 3 "$API/health" >/dev/null 2>&1; then
  STACK_UP=true
fi

JAR=$(mktemp)
if $STACK_UP && oidc_login "demo-operator" "$JAR" "Arcanium-ops-2026" && command -v jq >/dev/null 2>&1; then
  RECON_LEAK=$(curl -s -b "$JAR" "$API/api/v1/reconciliation" |
    jq '[.[] | select(.observation_status == "EXCEPTION_ACCEPTED")] | length' 2>/dev/null || echo "?")
  CONTROLS_LEAK=$(curl -s -b "$JAR" "$API/api/v1/controls" |
    jq '[.[] | select(.status == "EXCEPTION_ACCEPTED")] | length' 2>/dev/null || echo "?")
  if [ "$RECON_LEAK" = "0" ] && [ "$CONTROLS_LEAK" = "0" ]; then
    ok "no API response contains EXCEPTION_ACCEPTED as an observation_status/status value (checked /reconciliation + /controls, live)"
  else
    bad "EXCEPTION_ACCEPTED found in a status/observation_status field (reconciliation:$RECON_LEAK controls:$CONTROLS_LEAK) — that value belongs to disposition only"
  fi
  rm -f "$JAR"
else
  rm -f "$JAR"
  unk "EXCEPTION_ACCEPTED regression guard — identity stack/API/jq not reachable"
fi

# ── Prompt 23 — API explorer default-off guard ───────────────────────────
# The explorer must not be reachable with default compose-file settings
# (NODE_ENV=production AND ARCANIUM_API_EXPLORER_ENABLED unset/false).
# This checks the real running container — if HTTP 200 comes back something
# has accidentally enabled the explorer in a default deployment.
EXPLORER_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
  http://localhost:3001/api-docs 2>/dev/null || echo "000")
if [ "$EXPLORER_STATUS" = "000" ]; then
  unk "API explorer default-off guard — arcanium-api not reachable"
elif [ "$EXPLORER_STATUS" = "200" ]; then
  bad "API explorer is reachable without ARCANIUM_API_EXPLORER_ENABLED=true — the default-off gate has been bypassed"
else
  # 401 = route does not exist (requireSession fires before 404); 404 = also fine
  ok "API explorer not reachable by default (HTTP $EXPLORER_STATUS) — default-off gate intact"
fi

echo
TOTAL=$((PASS + FAIL + UNKNOWN))
echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $TOTAL) =="
[ "$FAIL" -eq 0 ]
