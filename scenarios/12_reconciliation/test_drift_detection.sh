#!/usr/bin/env bash
# scenarios/12_reconciliation/test_drift_detection.sh — Prompt 20 exit
# criterion. This does not finish because a /reconcile endpoint exists — it
# finishes when the full observe→drift→evidence→reconcile→recover sequence
# passes, scripted and re-runnable, including surviving an API restart
# mid-sequence (input/34).
set -uo pipefail
cd "$(dirname -- "$0")/../.." # -> repo root
set -a
[ -f .env ] && . ./.env
set +a

API="${ARCANIUM_API:-http://localhost:3001}"
APP_NAME="payments-api"
KEY_NAME="payments-api-key"

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
psqlc() {
  podman exec arcanium-postgres psql -U "${POSTGRES_USER:-arcanium}" -d "${POSTGRES_DB:-arcanium_db}" -tA -c "$1" 2>/dev/null | tr -d '[:space:]'
}

# ── real browser-simulated OIDC login (same as scenarios/11_security_foundation) ──
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

echo "== Prompt 20 — desired state + reconciliation: hostile drift-detection proof =="
echo "   API: $API"
echo

STACK_UP=false
if curl -fsS --max-time 3 "${ARCANIUM_OIDC_PUBLIC_URL:-http://localhost:8083}/realms/arcanium" >/dev/null 2>&1 &&
  curl -fsS --max-time 3 "$API/health" >/dev/null 2>&1; then
  STACK_UP=true
fi

JAR=$(mktemp)
if $STACK_UP && oidc_login "demo-architect" "$JAR" "Arcanium-arch-2026"; then
  echo "  (signed in as demo-architect)"
else
  echo "FATAL: could not sign in as demo-architect — is the identity stack up? (make identity-bootstrap)" >&2
  rm -f "$JAR"
  exit 1
fi

APP_ID=$(psqlc "SELECT id FROM applications WHERE name = '${APP_NAME}' LIMIT 1")
if [ -z "$APP_ID" ]; then
  echo "FATAL: no '${APP_NAME}' application found — run scenarios/01_onboarding first." >&2
  rm -f "$JAR"
  exit 1
fi

# ── 1 — Provision payments-api with 30-day rotation -> desired_state row created ──
PROVISION_RESP=$(curl -s -X POST -b "$JAR" -H 'content-type: application/json' \
  -d '{"custody":"vault","capabilities":["encrypt","decrypt"],"rotation_days":30}' \
  "$API/api/v1/applications/$APP_ID/provision")
DS_ID=$(psqlc "SELECT id FROM desired_state WHERE application_id = '${APP_ID}' AND key_name = '${KEY_NAME}' AND requirement = 'rotation_period'")
if [ -n "$DS_ID" ]; then
  ok "provision payments-api (30d rotation) -> desired_state row created ($DS_ID)"
else
  bad "provision payments-api -> no desired_state row found (response: $(echo "$PROVISION_RESP" | head -c 200))"
  rm -f "$JAR"
  exit 1
fi

# ── 2 — Run reconciliation -> COMPLIANT ──────────────────────────────────
RUN1=$(curl -s -X POST -b "$JAR" -H 'content-type: application/json' \
  -d "{\"desired_state_id\":\"$DS_ID\"}" "$API/api/v1/reconciliation/run")
STATUS1=$(echo "$RUN1" | jq -r '.[0].status // "MISSING"' 2>/dev/null)
RUN1_ID=$(echo "$RUN1" | jq -r '.[0].id // ""' 2>/dev/null)
[ "$STATUS1" = "COMPLIANT" ] && ok "run reconciliation -> COMPLIANT" || bad "run reconciliation (got $STATUS1, response: $(echo "$RUN1" | head -c 200))"

# ── 3 — Change the Vault config OUTSIDE Arcanium (simulate drift) ───────
DRIFTED=false
if [ -f .secrets/vault/cluster-init.json ] && command -v vault >/dev/null 2>&1; then
  ROOT_TOKEN=$(jq -er '.root_token' .secrets/vault/cluster-init.json 2>/dev/null)
  if [ -n "$ROOT_TOKEN" ]; then
    if VAULT_ADDR=https://127.0.0.1:18200 VAULT_TOKEN="$ROOT_TOKEN" VAULT_CACERT="$(pwd)/vault-tls/ca-chain.pem" \
      vault write "transit/keys/${KEY_NAME}/config" auto_rotate_period=0 >/dev/null 2>&1; then
      DRIFTED=true
    fi
  fi
fi
if $DRIFTED; then
  ok "drift injected outside Arcanium (auto_rotate_period set to 0 directly via Vault)"
else
  bad "could not inject drift — no local root token / vault CLI (see .secrets/vault/cluster-init.json)"
  rm -f "$JAR"
  exit 1
fi

# ── 4 — Run reconciliation -> DRIFTED ────────────────────────────────────
RUN2=$(curl -s -X POST -b "$JAR" -H 'content-type: application/json' \
  -d "{\"desired_state_id\":\"$DS_ID\"}" "$API/api/v1/reconciliation/run")
STATUS2=$(echo "$RUN2" | jq -r '.[0].status // "MISSING"' 2>/dev/null)
RUN2_ID=$(echo "$RUN2" | jq -r '.[0].id // ""' 2>/dev/null)
[ "$STATUS2" = "DRIFTED" ] && ok "run reconciliation after external change -> DRIFTED" ||
  bad "run reconciliation after external change (got $STATUS2)"

# ── 5 — Evidence: desired, observed, source, timestamp (queryable via API) ──
if [ -n "$RUN2_ID" ]; then
  DETAIL=$(curl -s -b "$JAR" "$API/api/v1/reconciliation/$RUN2_ID")
  DESIRED_DAYS=$(echo "$DETAIL" | jq -r '.desired_value.days // "MISSING"' 2>/dev/null)
  OBSERVED_DAYS=$(echo "$DETAIL" | jq -r '.run.observed_value.days // "MISSING"' 2>/dev/null)
  OBS_AT=$(echo "$DETAIL" | jq -r '.run.observed_at // "MISSING"' 2>/dev/null)
  if [ "$DESIRED_DAYS" = "30" ] && [ "$OBSERVED_DAYS" = "0" ] && [ "$OBS_AT" != "MISSING" ]; then
    ok "evidence shows desired=30d, observed=0d, timestamp=$OBS_AT (queryable via API)"
  else
    bad "evidence incomplete (desired=$DESIRED_DAYS observed=$OBSERVED_DAYS observed_at=$OBS_AT)"
  fi
else
  unk "evidence check — no run id from step 4"
fi

# ── 6 — Restart arcanium-api MID-SEQUENCE (right after observing DRIFTED) ──
# Proves state survives restart — Postgres-backed, never held only in memory.
echo "  -> restarting arcanium-api mid-sequence…"
if podman restart arcanium-api >/dev/null 2>&1; then
  for i in $(seq 1 30); do
    H=$(podman inspect arcanium-api --format '{{.State.Health.Status}}' 2>/dev/null)
    [ "$H" = "healthy" ] && break
    sleep 2
  done
  if [ "$H" = "healthy" ]; then
    ok "arcanium-api restarted and became healthy again"
  else
    bad "arcanium-api did not become healthy after restart (last status: $H)"
  fi
else
  bad "could not restart arcanium-api"
fi

# Re-login — the restart doesn't invalidate the session (Postgres-backed),
# but re-establish the cookie jar defensively in case of a cold-start race.
if ! session_check=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$API/api/v1/auth/me") || [ "$session_check" != "200" ]; then
  oidc_login "demo-architect" "$JAR" "Arcanium-arch-2026" || true
fi

if [ -n "$RUN2_ID" ]; then
  POST_RESTART=$(curl -s -b "$JAR" "$API/api/v1/reconciliation/$RUN2_ID")
  POST_STATUS=$(echo "$POST_RESTART" | jq -r '.run.status // "MISSING"' 2>/dev/null)
  POST_ID=$(echo "$POST_RESTART" | jq -r '.run.id // "MISSING"' 2>/dev/null)
  if [ "$POST_STATUS" = "DRIFTED" ] && [ "$POST_ID" = "$RUN2_ID" ]; then
    ok "the same DRIFTED run ($RUN2_ID) survives the restart — re-query returns identical data"
  else
    bad "run $RUN2_ID did not survive restart intact (status=$POST_STATUS id=$POST_ID)"
  fi
else
  unk "restart-survival check — no run id from step 4"
fi

# ── 7 — Reconcile -> Vault corrected ─────────────────────────────────────
if [ -n "$RUN2_ID" ]; then
  RECONCILE=$(curl -s -X POST -b "$JAR" "$API/api/v1/reconciliation/$RUN2_ID/reconcile")
  RESULT=$(echo "$RECONCILE" | jq -r '.action.result // "MISSING"' 2>/dev/null)
  CONFIRM_STATUS=$(echo "$RECONCILE" | jq -r '.confirmation_run.status // "MISSING"' 2>/dev/null)
  CONFIRM_ID=$(echo "$RECONCILE" | jq -r '.confirmation_run.id // ""' 2>/dev/null)
  if [ "$RESULT" = "applied" ] && [ "$CONFIRM_STATUS" = "COMPLIANT" ]; then
    ok "reconcile -> Vault corrected, re-observed as COMPLIANT"
  else
    bad "reconcile did not converge (result=$RESULT confirmation_status=$CONFIRM_STATUS, response: $(echo "$RECONCILE" | head -c 200))"
  fi
else
  unk "reconcile step — no run id from step 4"
fi

# ── 8 — Run reconciliation again -> COMPLIANT ────────────────────────────
RUN3=$(curl -s -X POST -b "$JAR" -H 'content-type: application/json' \
  -d "{\"desired_state_id\":\"$DS_ID\"}" "$API/api/v1/reconciliation/run")
STATUS3=$(echo "$RUN3" | jq -r '.[0].status // "MISSING"' 2>/dev/null)
[ "$STATUS3" = "COMPLIANT" ] && ok "run reconciliation again -> COMPLIANT" || bad "final reconciliation check (got $STATUS3)"

rm -f "$JAR"

echo
TOTAL=$((PASS + FAIL + UNKNOWN))
echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $TOTAL) =="
[ "$FAIL" -eq 0 ]
