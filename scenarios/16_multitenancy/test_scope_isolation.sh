#!/usr/bin/env bash
# scenarios/16_multitenancy/test_scope_isolation.sh — Prompt 27, Deliverable 6.
#
# Proves the scoped-grant path authorize() gained (env/team dimensions),
# using REAL sessions with REAL, narrowly-scoped LDAP group memberships —
# demo-operator-prod holds ONLY "arcanium-operator:env:production" (no bare
# arcanium-operator group) and demo-auditor-platform holds ONLY
# "arcanium-auditor:team:platform" — so a passing assertion here proves the
# scoped path actually restricts, not merely that it's additive on top of
# an already-unrestricted estate-wide role.
#
# Test case 4 substitutes GET/POST /api/v1/teams for the prompt's own
# illustrative "/api/v1/service-accounts" — no such route exists anywhere
# in this codebase (checked against real code, not assumed); teams.js is
# this same prompt's own estate-wide-only resource and demonstrates the
# identical point: a team-scoped grant never reaches a route that passes
# no `team` dimension to authorize() at all.
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

status_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# Same real browser-simulated OIDC round trip as
# scenarios/11_security_foundation/test_negative_auth.sh's own oidc_login.
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

echo "== Prompt 27 — Scope Isolation (Configurations A-D) =="

OP_JAR=$(mktemp)  # estate-wide operator — sets up fixtures, and is test case 3
OPP_JAR=$(mktemp) # demo-operator-prod — arcanium-operator:env:production only
AUD_JAR=$(mktemp) # demo-auditor-platform — arcanium-auditor:team:platform only

oidc_login demo-operator "$OP_JAR" "Arcanium-ops-2026" ||
  {
    echo "FATAL: could not log in as demo-operator — is the identity stack up?" >&2
    exit 1
  }
oidc_login demo-operator-prod "$OPP_JAR" "Arcanium-opprod-2026" ||
  {
    echo "FATAL: could not log in as demo-operator-prod — run 'make identity-bootstrap' to load the Prompt 27 LDAP fixture." >&2
    exit 1
  }
oidc_login demo-auditor-platform "$AUD_JAR" "Arcanium-auditplat-2026" ||
  {
    echo "FATAL: could not log in as demo-auditor-platform — run 'make identity-bootstrap'." >&2
    exit 1
  }
echo "  (real OIDC sessions established for all 3 test identities)"

# ── Fixture setup (idempotent) — real data, not mocked ──────────────────
echo
echo "-- fixtures --"

# A "platform" team covering cocacola's supplier (ticket-service belongs to
# it) — this is what makes demo-auditor-platform's team scope resolve to a
# real, non-empty set of applications.
COCACOLA_ID=$(curl -s -b "$OP_JAR" "$API/api/v1/suppliers" | jq -r '.[] | select(.vault_namespace=="suppliers/cocacola") | .id' | head -1)
if [ -z "$COCACOLA_ID" ]; then
  echo "FATAL: cocacola supplier not found — run scenarios/01_onboarding first." >&2
  exit 1
fi
EXISTING_TEAM=$(curl -s -b "$OP_JAR" "$API/api/v1/teams" | jq -r '.[] | select(.name=="platform") | .id' | head -1)
if [ -n "$EXISTING_TEAM" ]; then
  curl -s -b "$OP_JAR" -X PATCH "$API/api/v1/teams/$EXISTING_TEAM" \
    -H "Content-Type: application/json" -d "{\"supplier_ids\":[\"$COCACOLA_ID\"]}" >/dev/null
  echo "  = team 'platform' already exists — supplier_ids refreshed"
else
  curl -s -b "$OP_JAR" -X POST "$API/api/v1/teams" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"platform\",\"description\":\"Prompt 27 scope-isolation fixture\",\"supplier_ids\":[\"$COCACOLA_ID\"]}" >/dev/null
  echo "  + team 'platform' created (supplier_ids: cocacola)"
fi

# A staging application with a real desired_state row + reconciliation_run
# — Configuration B's own scenario (environment partitioning).
STAGING_APP_ID=$(curl -s -b "$OP_JAR" "$API/api/v1/applications" | jq -r '.[] | select(.name=="scope-isolation-staging-app") | .id' | head -1)
if [ -z "$STAGING_APP_ID" ]; then
  STAGING_APP_ID=$(curl -s -b "$OP_JAR" -X POST "$API/api/v1/applications" \
    -H "Content-Type: application/json" \
    -d '{"name":"scope-isolation-staging-app","description":"Prompt 27 fixture","environment":"staging"}' | jq -r '.id')
  echo "  + application 'scope-isolation-staging-app' created (environment: staging)"
else
  echo "  = application 'scope-isolation-staging-app' already exists"
fi
[ -n "$STAGING_APP_ID" ] && [ "$STAGING_APP_ID" != "null" ] ||
  {
    echo "FATAL: could not create/resolve the staging fixture application" >&2
    exit 1
  }

DS_ROW=$(curl -s -b "$OP_JAR" "$API/api/v1/reconciliation" | jq -r --arg id "$STAGING_APP_ID" '.[] | select(.application_id==$id)' | head -1)
STAGING_DS_ID=$(echo "$DS_ROW" | jq -r '.desired_state_id // empty' 2>/dev/null)
if [ -z "$STAGING_DS_ID" ]; then
  curl -s -b "$OP_JAR" -X POST "$API/api/v1/applications/$STAGING_APP_ID/provision" \
    -H "Content-Type: application/json" \
    -d '{"custody":"vault","capabilities":["encrypt","decrypt"],"rotation_days":30}' >/dev/null
  STAGING_DS_ID=$(curl -s -b "$OP_JAR" "$API/api/v1/reconciliation" | jq -r --arg id "$STAGING_APP_ID" '.[] | select(.application_id==$id) | .desired_state_id' | head -1)
  echo "  + provisioned scope-isolation-staging-app (seeds desired_state)"
fi
[ -n "$STAGING_DS_ID" ] && [ "$STAGING_DS_ID" != "null" ] ||
  {
    echo "FATAL: no desired_state row for the staging fixture application" >&2
    exit 1
  }

# Deliberately drift it: Vault's own key config keeps whatever
# rotation_days was last provisioned with; declaring a DIFFERENT desired
# value here — before any observation is taken against it — guarantees the
# run below is genuinely DRIFTED, so test case 3's reconcile assertion
# below gets a real 200, not an ambiguous 409 "already compliant, nothing
# to do" (a correct outcome in its own right, but not one this scenario
# should have to shrug off). Toggles between 45/30 so a re-run of this
# already-fixtured scenario still produces fresh drift, not a no-op PATCH
# to the same value a previous run already settled on.
current_days=$(curl -s -b "$OP_JAR" "$API/api/v1/reconciliation" | jq -r --arg id "$STAGING_DS_ID" '.[] | select(.desired_state_id==$id) | .desired_value.days' 2>/dev/null)
new_days=45
[ "$current_days" = "45" ] && new_days=30
curl -s -b "$OP_JAR" -X PATCH "$API/api/v1/reconciliation/desired-state/$STAGING_DS_ID" \
  -H "Content-Type: application/json" -d "{\"desired_value\":{\"days\":$new_days},\"reason\":\"scope-isolation fixture — force a real drift\"}" >/dev/null

STAGING_RUN_ID=$(curl -s -b "$OP_JAR" -X POST "$API/api/v1/reconciliation/run" \
  -H "Content-Type: application/json" -d "{\"desired_state_id\":\"$STAGING_DS_ID\"}" |
  jq -r '.[0].id // empty' 2>/dev/null)
if [ -z "$STAGING_RUN_ID" ]; then
  STAGING_RUN_ID=$(curl -s -b "$OP_JAR" "$API/api/v1/reconciliation" | jq -r --arg id "$STAGING_DS_ID" '.[] | select(.desired_state_id==$id) | .latest_run.id' | head -1)
fi
[ -n "$STAGING_RUN_ID" ] && [ "$STAGING_RUN_ID" != "null" ] ||
  {
    echo "FATAL: could not produce a reconciliation_runs row for the staging fixture" >&2
    exit 1
  }
run_status=$(curl -s -b "$OP_JAR" "$API/api/v1/reconciliation/$STAGING_RUN_ID" | jq -r '.observation_status // empty' 2>/dev/null)
echo "  (staging app=$STAGING_APP_ID desired_state=$STAGING_DS_ID run=$STAGING_RUN_ID status=$run_status)"

# ── Test case 1: operator:env:production ────────────────────────────────
echo
echo "-- 1. operator:env:production (demo-operator-prod) --"

code=$(status_of -b "$OPP_JAR" -X POST "$API/api/v1/reconciliation/run" \
  -H "Content-Type: application/json" -d "{\"desired_state_id\":\"$STAGING_DS_ID\"}")
[ "$code" = "403" ] && ok "POST /reconciliation/run (staging desired_state) -> 403" ||
  bad "POST /reconciliation/run (staging desired_state) -> expected 403, got $code"

list_len=$(curl -s -b "$OPP_JAR" "$API/api/v1/reconciliation?env=staging" | jq 'length' 2>/dev/null)
[ "$list_len" = "0" ] && ok "GET /reconciliation?env=staging -> empty list" ||
  bad "GET /reconciliation?env=staging -> expected empty list, got length=$list_len"

code=$(status_of -b "$OPP_JAR" -X POST "$API/api/v1/reconciliation/$STAGING_RUN_ID/reconcile")
[ "$code" = "403" ] && ok "POST /reconciliation/:run_id/reconcile (staging run) -> 403" ||
  bad "POST /reconciliation/:run_id/reconcile (staging run) -> expected 403, got $code"

# Deliverable 5's own audit fix: a direct-by-id fetch must be scoped the
# same way the list is, not just filtered out of GET /applications.
code=$(status_of -b "$OPP_JAR" "$API/api/v1/applications/$STAGING_APP_ID")
[ "$code" = "404" ] && ok "GET /applications/:id (staging app, direct fetch) -> 404" ||
  bad "GET /applications/:id (staging app, direct fetch) -> expected 404, got $code"
code=$(status_of -b "$OPP_JAR" "$API/api/v1/applications/$STAGING_APP_ID/intent")
[ "$code" = "404" ] && ok "GET /applications/:id/intent (staging app, direct fetch) -> 404" ||
  bad "GET /applications/:id/intent (staging app, direct fetch) -> expected 404, got $code"

# ── Test case 2: auditor:team:platform ───────────────────────────────────
echo
echo "-- 2. auditor:team:platform (demo-auditor-platform) --"

apps=$(curl -s -b "$AUD_JAR" "$API/api/v1/applications")
platform_count=$(echo "$apps" | jq --arg sid "$COCACOLA_ID" '[.[] | select(.supplier_id==$sid)] | length' 2>/dev/null)
[ -n "$platform_count" ] && [ "$platform_count" -gt 0 ] 2>/dev/null &&
  ok "GET /applications (platform-team's cocacola apps) -> non-empty ($platform_count)" ||
  bad "GET /applications (platform-team's cocacola apps) -> expected non-empty, got '$platform_count'"

non_platform_count=$(echo "$apps" | jq --arg sid "$COCACOLA_ID" '[.[] | select(.supplier_id != $sid)] | length' 2>/dev/null)
[ "$non_platform_count" = "0" ] && ok "GET /applications (non-platform-team apps) -> filtered out (0)" ||
  bad "GET /applications (non-platform-team apps) -> expected 0 non-platform apps visible, got $non_platform_count"

code=$(status_of -b "$AUD_JAR" -X POST "$API/api/v1/reconciliation/run")
[ "$code" = "403" ] && ok "POST /reconciliation/run (bulk sweep, no resource to scope against) -> 403" ||
  bad "POST /reconciliation/run (bulk sweep) -> expected 403, got $code"

# ── Test case 3: estate-wide operator (no scoped grant) — backward-compat ─
echo
echo "-- 3. estate-wide operator, no scoped grant (demo-operator) --"

resp=$(curl -s -b "$OP_JAR" -X POST "$API/api/v1/reconciliation/run" \
  -H "Content-Type: application/json" -d "{\"desired_state_id\":\"$STAGING_DS_ID\"}")
echo "$resp" | jq -e 'length > 0' >/dev/null 2>&1 &&
  ok "POST /reconciliation/run (staging desired_state) -> allowed, unchanged" ||
  bad "POST /reconciliation/run (staging desired_state) -> expected a non-empty result, got: $resp"

list_len=$(curl -s -b "$OP_JAR" "$API/api/v1/reconciliation?env=staging" | jq 'length' 2>/dev/null)
[ -n "$list_len" ] && [ "$list_len" -ge 1 ] 2>/dev/null &&
  ok "GET /reconciliation?env=staging -> sees the staging row, unchanged ($list_len)" ||
  bad "GET /reconciliation?env=staging -> expected >=1, got '$list_len'"

code=$(status_of -b "$OP_JAR" -X POST "$API/api/v1/reconciliation/$STAGING_RUN_ID/reconcile")
[ "$code" = "200" ] && ok "POST /reconciliation/:run_id/reconcile (staging run, genuinely DRIFTED) -> 200, unchanged" ||
  bad "POST /reconciliation/:run_id/reconcile -> expected 200, got $code"

# ── Test case 4: scoped grant never reaches an estate-only route ────────
echo
echo "-- 4. scoped grant (team) vs. an estate-wide-only resource --"
echo "   (substituting POST/GET /api/v1/teams for the prompt's own"
echo "   illustrative \"/api/v1/service-accounts\", which does not exist in"
echo "   this codebase — teams.js is this same prompt's own estate-only"
echo "   resource and proves the identical point)"

code=$(status_of -b "$AUD_JAR" "$API/api/v1/teams")
[ "$code" = "403" ] && ok "GET /teams (team-scoped auditor, estate-only resource) -> 403" ||
  bad "GET /teams -> expected 403, got $code"

code=$(status_of -b "$OPP_JAR" -X POST "$API/api/v1/teams" \
  -H "Content-Type: application/json" -d '{"name":"should-not-be-created"}')
[ "$code" = "403" ] && ok "POST /teams (env-scoped operator, estate-only resource) -> 403" ||
  bad "POST /teams -> expected 403, got $code"

# ── Demo-persona cannot smuggle a scope elevation ────────────────────────
echo
echo "-- demo-persona switch cannot grant a scope --"
code=$(status_of -b "$OP_JAR" -X POST "$API/api/v1/auth/demo-persona" \
  -H "Content-Type: application/json" -d '{"persona":"operator:env:production"}')
case "$code" in
400 | 403) ok "POST /auth/demo-persona {persona:'operator:env:production'} -> $code (rejected, not silently accepted)" ;;
*) bad "POST /auth/demo-persona scope-elevation attempt -> expected 400/403, got $code" ;;
esac

echo
hr() { echo "  ──────────────────────────────────────────────"; }
hr
echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $((PASS + FAIL + UNKNOWN))) =="

# Prompt 27, Deliverable 8 — same marker-file convention
# scenarios/pre_24_persistence/test_restart_persistence.sh already
# established: state/scripts/capture-state.sh reads this (PASS/FAIL, plus
# the file's own mtime as "last run") rather than re-deriving it.
if [ "$FAIL" -eq 0 ]; then
  echo "PASS" >state/.last-scope-isolation-result
else
  echo "FAIL" >state/.last-scope-isolation-result
fi

[ "$FAIL" -eq 0 ]
