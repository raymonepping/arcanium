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

# ── Prompt 28, Deliverable 8 ──────────────────────────────────────────────
psqlc() {
  podman exec arcanium-postgres psql -U "${POSTGRES_USER:-arcanium}" -d "${POSTGRES_DB:-arcanium_db}" -tA -c "$1" 2>/dev/null
}

# The earlier EXCEPTION_ACCEPTED check above already removed its own $JAR —
# a fresh session (demo-architect: provision=true, same as demo-operator)
# is needed for these checks, not a reuse of that deleted cookie jar.
JAR=$(mktemp)
if ! ($STACK_UP && oidc_login "demo-architect" "$JAR" "Arcanium-arch-2026"); then
  rm -f "$JAR"
  JAR=""
fi

# (a) — a service-account token value is never echoed back anywhere except
# the single POST /:id/tokens response that issued it.
if [ -n "$JAR" ] && command -v jq >/dev/null 2>&1; then
  SA_CREATE=$(curl -s -b "$JAR" -X POST "$API/api/v1/service-accounts" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"fitness-test-sa-$(date +%s)\",\"description\":\"scenario 13 fitness check\",\"roles\":[\"auditor\"]}")
  SA_ID=$(echo "$SA_CREATE" | jq -r '.id // empty')
  if [ -n "$SA_ID" ]; then
    TOKEN_RESP=$(curl -s -b "$JAR" -X POST "$API/api/v1/service-accounts/$SA_ID/tokens" \
      -H 'Content-Type: application/json' -d '{"description":"fitness test token"}')
    TOKEN_VALUE=$(echo "$TOKEN_RESP" | jq -r '.token // empty')
    if [ -n "$TOKEN_VALUE" ]; then
      DETAIL_BODY=$(curl -s -b "$JAR" "$API/api/v1/service-accounts/$SA_ID")
      LIST_BODY=$(curl -s -b "$JAR" "$API/api/v1/service-accounts")
      if echo "$DETAIL_BODY$LIST_BODY" | grep -qF "$TOKEN_VALUE"; then
        bad "service-account token value leaked outside its single POST /tokens issuance response"
      else
        ok "service-account token value appears ONLY in its one-time POST /tokens response, never in GET detail/list"
      fi
    else
      unk "service-account token leak check — token issuance did not return a token value"
    fi
    curl -s -b "$JAR" -X DELETE "$API/api/v1/service-accounts/$SA_ID" >/dev/null
  else
    unk "service-account token leak check — could not create a test service account"
  fi
else
  unk "service-account token leak check — identity stack/API/jq not reachable"
fi

# (b) — every webhook delivery attempt is recorded in webhook_deliveries,
# never a silent drop, even when the endpoint is unreachable.
if [ -n "$JAR" ] && command -v jq >/dev/null 2>&1; then
  WH_CREATE=$(curl -s -b "$JAR" -X POST "$API/api/v1/webhooks" \
    -H 'Content-Type: application/json' \
    -d '{"url":"http://127.0.0.1:1/unreachable-fitness-sink","events":["reconciliation.drifted"],"description":"fitness test sink (deliberately unreachable)"}')
  WH_ID=$(echo "$WH_CREATE" | jq -r '.id // empty')
  DS_ID=$(psqlc "SELECT id FROM desired_state WHERE requirement='rotation_period' AND archived_at IS NULL LIMIT 1" | tr -d '[:space:]')
  if [ -n "$WH_ID" ] && [ -n "$DS_ID" ]; then
    BEFORE=$(psqlc "SELECT count(*) FROM webhook_deliveries WHERE endpoint_id='$WH_ID'" | tr -d '[:space:]')
    CUR_DAYS=$(psqlc "SELECT desired_value->>'days' FROM desired_state WHERE id='$DS_ID'" | tr -d '[:space:]')
    # rotation_period's comparator (reconciliation/diff.js compare()) is a
    # plain deep-equal between desired_value and the LIVE Vault key's own
    # configured auto_rotate_period — not an age/threshold check. So
    # COMPLIANT is only reachable by matching that real Vault-side value
    # exactly; an arbitrarily "generous" desired value (e.g. 36500) is
    # just as much a mismatch as any other and stays DRIFTED forever, and
    # a blind 30<->45 (or fixed 1-day) toggle is not reliably a state
    # TRANSITION either, since events only fire on priorStatus !=
    # newStatus (engine.js) — both were real, confirmed sources of test
    # flakiness (found live, not assumed). Read the key's REAL observed
    # value first, match it exactly to force COMPLIANT, then diverge from
    # it to force DRIFTED — the only way to guarantee a genuine
    # transition regardless of this key's actual Vault configuration.
    OBSERVED_DAYS=$(curl -s -b "$JAR" -X POST "$API/api/v1/reconciliation/run" |
      jq -r --arg id "$DS_ID" '.[] | select(.desired_state_id==$id) | .observed_value.days // empty')
    if [ -n "$OBSERVED_DAYS" ]; then
      curl -s -b "$JAR" -X PATCH "$API/api/v1/reconciliation/desired-state/$DS_ID" \
        -H 'Content-Type: application/json' \
        -d "{\"desired_value\":{\"days\":$OBSERVED_DAYS},\"reason\":\"fitness test — match the real observed value to establish a known-COMPLIANT baseline\"}" >/dev/null
      BASELINE=$(curl -s -b "$JAR" -X POST "$API/api/v1/reconciliation/run" |
        jq -r --arg id "$DS_ID" '.[] | select(.desired_state_id==$id) | .status')
    else
      BASELINE=""
    fi
    if [ "$BASELINE" = "COMPLIANT" ]; then
      DIVERGED_DAYS=$((OBSERVED_DAYS + 1))
      curl -s -b "$JAR" -X PATCH "$API/api/v1/reconciliation/desired-state/$DS_ID" \
        -H 'Content-Type: application/json' \
        -d "{\"desired_value\":{\"days\":$DIVERGED_DAYS},\"reason\":\"fitness test — force a genuine COMPLIANT->DRIFTED transition\"}" >/dev/null
      FLIPPED=$(curl -s -b "$JAR" -X POST "$API/api/v1/reconciliation/run" |
        jq -r --arg id "$DS_ID" '.[] | select(.desired_state_id==$id) | .status')
      sleep 2
      AFTER=$(psqlc "SELECT count(*) FROM webhook_deliveries WHERE endpoint_id='$WH_ID'" | tr -d '[:space:]')
      if [ "$FLIPPED" = "DRIFTED" ] && [ "${AFTER:-0}" -gt "${BEFORE:-0}" ]; then
        ok "a real reconciliation.drifted transition produced a recorded row in webhook_deliveries (even for an unreachable endpoint)"
      elif [ "$FLIPPED" != "DRIFTED" ]; then
        unk "webhook delivery recording check — could not force a DRIFTED status even by diverging from a confirmed COMPLIANT baseline (got: $FLIPPED)"
      else
        bad "no webhook_deliveries row was recorded for a genuine reconciliation.drifted transition"
      fi
    else
      unk "webhook delivery recording check — could not establish a known-COMPLIANT baseline by matching the real observed value (got: ${BASELINE:-empty})"
    fi
    # Restore the fixture's original desired_value — this is real, shared
    # demo data (not a disposable test-only row), and leaving it pinned at
    # a forced value would leave that key's rotation policy wrong in every
    # future demo/screenshot/maturity score, not just for this test.
    curl -s -b "$JAR" -X PATCH "$API/api/v1/reconciliation/desired-state/$DS_ID" \
      -H 'Content-Type: application/json' \
      -d "{\"desired_value\":{\"days\":$CUR_DAYS},\"reason\":\"fitness test cleanup — restoring original rotation window\"}" >/dev/null
    curl -s -b "$JAR" -X POST "$API/api/v1/reconciliation/run" >/dev/null
    curl -s -b "$JAR" -X DELETE "$API/api/v1/webhooks/$WH_ID" >/dev/null
  else
    unk "webhook delivery recording check — could not create endpoint/fixture"
  fi
else
  unk "webhook delivery recording check — identity stack/API/jq not reachable"
fi
[ -n "${JAR:-}" ] && rm -f "$JAR"

# (c) — the Terraform provider skeleton's HTTP client authenticates with
# Authorization: Bearer, never a Cookie header (the M2M surface, not the
# human session path). Static check here; scenario-terraform-provider
# proves this dynamically against a real terraform apply.
PROVIDER_CLIENT="terraform/arcanium-provider/internal/provider/client.go"
if [ -f "$PROVIDER_CLIENT" ]; then
  if grep -q '"Authorization", "Bearer "' "$PROVIDER_CLIENT" && ! grep -qi '"Cookie"' "$PROVIDER_CLIENT"; then
    ok "terraform-provider-arcanium's client sends Authorization: Bearer, never a Cookie header"
  else
    bad "terraform-provider-arcanium's client does not match the expected Bearer-only auth pattern"
  fi
else
  unk "terraform provider Bearer-auth check — $PROVIDER_CLIENT not found"
fi

# (d) — no hard DELETE of desired_state, evidence, reconciliation_runs, or
# control_assessments rows anywhere in a route handler. Tombstone
# (archived_at) discipline, not a cascade delete, for anything that is
# itself an audit/evidence trail — applications and approval_requests rows
# are NOT in this list; those are registry/workflow rows, not evidence.
HITS=$(grep -rniE "DELETE FROM (desired_state|evidence|reconciliation_runs|control_assessments)\b" \
  arcanium/api/src/routes arcanium/api/src/offboarding.js arcanium/api/src/reconciliation 2>/dev/null || true)
if [ -z "$HITS" ]; then
  ok "no hard DELETE of desired_state/evidence/reconciliation_runs/control_assessments rows in any route handler"
else
  bad "a hard DELETE of an evidence/history table was found: $HITS"
fi

echo
TOTAL=$((PASS + FAIL + UNKNOWN))
echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $TOTAL) =="
[ "$FAIL" -eq 0 ]
