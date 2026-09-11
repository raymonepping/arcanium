#!/usr/bin/env bash
# scenarios/11_security_foundation/test_negative_auth.sh — Prompt 18 exit
# criterion. This does not finish because OIDC login works — it finishes
# when all 13 hostile assertions from input/35 are proven, scripted, and
# re-runnable.
#
# Persona logins (assertions 3-7) drive a REAL Authorization Code + PKCE
# round trip against the live Keycloak realm via curl (following the actual
# HTML login form, not a mock) — the same mechanism a browser would use,
# scripted instead of clicked. Assertions 12/13 exercise the real
# client.authorizationCodeGrant() call path via check_token_validation.mjs.
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

# ── real browser-simulated OIDC login ───────────────────────────────────
# Drives Express's actual /login -> Keycloak login form -> /callback round
# trip. Leaves a valid arc_session cookie in $2 on success.
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

# Drives the SAME browser-simulated flow but stops short of calling Express's
# callback — returns "code|pkce_verifier" on stdout for the raw
# issuer/audience checks (check_token_validation.mjs), which need the code
# and verifier directly rather than having Express consume them.
raw_authorize_get_code() {
  local user="$1" pass="$2"
  local verifier challenge state jar auth_url form_html form_action cb_headers cb_url code

  # openid-client is only installed under arcanium/api's node_modules, and
  # Node's ESM resolver (unlike CommonJS require) does not honor NODE_PATH
  # — found by actually running this from the repo root, where the bare
  # `import("openid-client")` failed with ERR_MODULE_NOT_FOUND. Running from
  # arcanium/api resolves it correctly.
  read -r verifier challenge < <(cd arcanium/api && node -e '
    import("openid-client").then(async (c) => {
      const v = c.randomPKCECodeVerifier();
      const ch = await c.calculatePKCECodeChallenge(v);
      console.log(v, ch);
    });' 2>/dev/null)
  [ -z "${verifier:-}" ] && return 1
  state=$(cd arcanium/api && node -e 'import("openid-client").then(c=>console.log(c.randomState()))' 2>/dev/null)

  jar=$(mktemp)
  auth_url="${ARCANIUM_OIDC_PUBLIC_URL}/realms/arcanium/protocol/openid-connect/auth"
  auth_url="${auth_url}?client_id=${ARCANIUM_OIDC_CLIENT_ID}&response_type=code"
  auth_url="${auth_url}&redirect_uri=$(node -e "console.log(encodeURIComponent(process.env.ARCANIUM_API_CALLBACK_URL))")"
  auth_url="${auth_url}&scope=openid&code_challenge=${challenge}&code_challenge_method=S256&state=${state}"

  form_html=$(curl -s -c "$jar" -b "$jar" "$auth_url")
  form_action=$(echo "$form_html" | grep -oE 'action="[^"]*"' | head -1 |
    sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
  [ -z "$form_action" ] && {
    rm -f "$jar"
    return 1
  }

  cb_headers=$(curl -sD - -o /dev/null -c "$jar" -b "$jar" \
    --data-urlencode "username=$user" --data-urlencode "password=$pass" \
    "$form_action")
  cb_url=$(echo "$cb_headers" | grep -i '^location:' | awk '{print $2}' | tr -d '\r\n')
  rm -f "$jar"
  code=$(echo "$cb_url" | grep -oE 'code=[^&]*' | head -1 | cut -d= -f2)
  [ -z "$code" ] && return 1
  echo "${code}|${verifier}"
}

STACK_UP=false
if curl -fsS --max-time 3 "${ARCANIUM_OIDC_PUBLIC_URL:-http://localhost:8083}/realms/arcanium" >/dev/null 2>&1 &&
  curl -fsS --max-time 3 "$API/health" >/dev/null 2>&1; then
  STACK_UP=true
fi

echo "== Prompt 18 — hostile negative-auth suite =="
echo "   API: $API"
echo "   identity stack reachable: $STACK_UP"
echo

# ── 1/2 — anonymous ──────────────────────────────────────────────────────
S=$(status_of "$API/api/v1/keys")
[ "$S" = "401" ] && ok "anonymous GET /api/v1/keys -> 401" || bad "anonymous GET /api/v1/keys (got $S)"

S=$(status_of -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/applications")
[ "$S" = "401" ] && ok "anonymous POST /api/v1/applications -> 401" || bad "anonymous POST /api/v1/applications (got $S)"

# ── 10 — forged/modified session cookie ──────────────────────────────────
S=$(status_of -H "Cookie: arc_session=$(openssl rand -hex 32 2>/dev/null || echo deadbeef)" "$API/api/v1/keys")
[ "$S" = "401" ] && ok "modified/forged session cookie -> 401" || bad "forged session cookie (got $S)"

# ── 9 — expired session ──────────────────────────────────────────────────
# ON CONFLICT DO NOTHING: the fixed id is deliberate (matched by the curl
# check below) and a prior run's row satisfies this check just as well as a
# freshly-inserted one — a re-run must not report UNKNOWN just because the
# row already exists from last time.
if podman exec arcanium-postgres psql -U "${POSTGRES_USER:-arcanium}" -d "${POSTGRES_DB:-arcanium_db}" \
  -c "INSERT INTO sessions (id, username, persona, namespaces, groups, expires_at, last_seen_at) \
        VALUES ('11test0000000000000000000000000000000000000000000000000000', 'demo-expired', 'operator', '{}', '{}', now() - interval '1 hour', now() - interval '1 hour') \
        ON CONFLICT (id) DO NOTHING" \
  >/dev/null 2>&1; then
  S=$(status_of -H "Cookie: arc_session=11test0000000000000000000000000000000000000000000000000000" "$API/api/v1/keys")
  [ "$S" = "401" ] && ok "expired session -> 401" || bad "expired session (got $S)"
else
  unk "expired session — could not reach arcanium-postgres to seed the row"
fi

# ── 11 — invalid OIDC state on callback ──────────────────────────────────
if $STACK_UP; then
  PENDING_JAR=$(mktemp)
  curl -s -o /dev/null -c "$PENDING_JAR" "$API/api/v1/auth/login?next=/" >/dev/null 2>&1
  S=$(status_of -b "$PENDING_JAR" "$API/api/v1/auth/callback?state=deliberately-wrong-state&code=irrelevant")
  [ "$S" != "200" ] && [ "$S" != "302" ] && ok "invalid OIDC state on callback -> rejected ($S)" ||
    bad "invalid OIDC state on callback (got $S)"
  rm -f "$PENDING_JAR"
else
  unk "invalid OIDC state — identity stack not reachable"
fi

# ── persona sessions for 3-7 ──────────────────────────────────────────────
declare -A JAR PASSWORD
JAR[auditor]=$(mktemp)
PASSWORD[auditor]="Arcanium-audit-2026"
JAR[architect]=$(mktemp)
PASSWORD[architect]="Arcanium-arch-2026"
JAR[operator]=$(mktemp)
PASSWORD[operator]="Arcanium-ops-2026"
JAR[pepsi]=$(mktemp)
PASSWORD[pepsi]="Arcanium-pepsi-2026"
JAR[cocacola]=$(mktemp)
PASSWORD[cocacola]="Arcanium-cocacola-2026"

if $STACK_UP; then
  for p in auditor architect operator pepsi cocacola; do
    if oidc_login "demo-$p" "${JAR[$p]}" "${PASSWORD[$p]}"; then
      echo "  (signed in as demo-$p)"
    else
      echo "  (sign-in failed for demo-$p — dependent checks will be UNKNOWN)"
      : >"${JAR[$p]}"
    fi
  done
fi

session_ok() { [ -s "$1" ] && grep -q arc_session "$1"; }

# ── 3 — auditor rotate key -> 403 ────────────────────────────────────────
if session_ok "${JAR[auditor]}"; then
  S=$(status_of -X POST -b "${JAR[auditor]}" "$API/api/v1/keys/payments-api-key/rotate")
  [ "$S" = "403" ] && ok "auditor rotate key -> 403" || bad "auditor rotate key (got $S)"
else
  unk "auditor rotate key — no session"
fi

# ── Prompt 20 — auditor reconcile -> 403 ─────────────────────────────────
# Matches the auditor-rotate-key pattern above: 'reconcile' is the same
# matrix row as 'rotate' (auth/authorize.js), so auditor must be denied the
# same way. Needs a real run id — reconciliation_runs is only populated
# once scenarios/12_reconciliation has run at least once; reported UNKNOWN
# (not a false PASS/FAIL) rather than fabricated otherwise.
ANY_RUN=$(podman exec arcanium-postgres psql -U "${POSTGRES_USER:-arcanium}" -d "${POSTGRES_DB:-arcanium_db}" -tA \
  -c "SELECT id FROM reconciliation_runs ORDER BY observed_at DESC LIMIT 1" 2>/dev/null | tr -d '[:space:]')
if session_ok "${JAR[auditor]}" && [ -n "$ANY_RUN" ]; then
  S=$(status_of -X POST -b "${JAR[auditor]}" "$API/api/v1/reconciliation/$ANY_RUN/reconcile")
  [ "$S" = "403" ] && ok "auditor reconcile -> 403" || bad "auditor reconcile (got $S)"
else
  unk "auditor reconcile — no session, or no reconciliation_runs fixture (run scenarios/12_reconciliation first)"
fi

# ── Prompt 20 — pepsi-admin cross-tenant reconciliation read/action -> 404 ──
# Same discipline as Phase 18's own GET /applications/:id fix: the fixture
# run belongs to payments-api, a root-namespace (unscoped) application —
# never visible to any supplier-admin, so this must always be 404.
if session_ok "${JAR[pepsi]}" && [ -n "$ANY_RUN" ]; then
  S=$(status_of -b "${JAR[pepsi]}" "$API/api/v1/reconciliation/$ANY_RUN")
  [ "$S" = "404" ] && ok "pepsi-admin GET cross-tenant reconciliation run -> 404" ||
    bad "pepsi-admin GET cross-tenant reconciliation run (got $S)"

  S=$(status_of -X POST -b "${JAR[pepsi]}" "$API/api/v1/reconciliation/$ANY_RUN/reconcile")
  [ "$S" = "404" ] && ok "pepsi-admin reconcile cross-tenant run -> 404" ||
    bad "pepsi-admin reconcile cross-tenant run (got $S)"
else
  unk "pepsi-admin cross-tenant reconciliation checks — no session, or no reconciliation_runs fixture"
fi

# ── 4 — architect rewrap -> 403 ──────────────────────────────────────────
if session_ok "${JAR[architect]}"; then
  S=$(status_of -X POST -b "${JAR[architect]}" -H 'content-type: application/json' \
    -d '{"ciphertext":"vault:v1:bogus"}' "$API/api/v1/keys/payments-api-key/rewrap")
  [ "$S" = "403" ] && ok "architect rewrap -> 403" || bad "architect rewrap (got $S)"
else
  unk "architect rewrap — no session"
fi

# ── 5 — operator rewrap -> 200 ───────────────────────────────────────────
# Arcanium's API has no /encrypt route (rewrap is deliberately the only
# ciphertext-handling operation it exposes — see keys.js's own comment:
# "CIPHERTEXT ONLY, operator-gated"). Fixture setup only (not the thing
# under test) — produce a real ciphertext by calling Vault Transit directly
# with the local root token, the same way scripts/vault-status.sh does.
if session_ok "${JAR[operator]}" && [ -f .secrets/vault/cluster-init.json ] && command -v jq >/dev/null 2>&1; then
  ROOT_TOKEN=$(jq -er '.root_token' .secrets/vault/cluster-init.json 2>/dev/null)
  CIPHERTEXT=""
  if [ -n "$ROOT_TOKEN" ]; then
    CIPHERTEXT=$(VAULT_ADDR=https://127.0.0.1:18200 VAULT_TOKEN="$ROOT_TOKEN" VAULT_CACERT="$(pwd)/vault-tls/ca-chain.pem" \
      vault write -field=ciphertext transit/encrypt/payments-api-key plaintext="$(printf 'test' | base64)" 2>/dev/null)
  fi
  if [ -n "$CIPHERTEXT" ]; then
    S=$(status_of -X POST -b "${JAR[operator]}" -H 'content-type: application/json' \
      -d "{\"ciphertext\":\"$CIPHERTEXT\"}" "$API/api/v1/keys/payments-api-key/rewrap")
    [ "$S" = "200" ] && ok "operator rewrap -> 200" || bad "operator rewrap (got $S)"
  else
    unk "operator rewrap — could not produce a fixture ciphertext (payments-api-key unavailable?)"
  fi
else
  unk "operator rewrap — no session, or no local root token to prepare a fixture ciphertext"
fi

# ── 6/7 — pepsi-admin tenant read boundary ───────────────────────────────
if session_ok "${JAR[pepsi]}"; then
  S=$(status_of -b "${JAR[pepsi]}" "$API/api/v1/suppliers")
  [ "$S" = "200" ] && ok "pepsi-admin read (own scope) -> 200" || bad "pepsi-admin read (got $S)"

  # Resolve cocacola's application id (if any) to probe a cross-tenant read.
  COKE_APP=$(podman exec arcanium-postgres psql -U "${POSTGRES_USER:-arcanium}" -d "${POSTGRES_DB:-arcanium_db}" -tA \
    -c "SELECT a.id FROM applications a JOIN suppliers s ON s.id=a.supplier_id WHERE s.vault_namespace='suppliers/cocacola' LIMIT 1" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$COKE_APP" ]; then
    S=$(status_of -b "${JAR[pepsi]}" "$API/api/v1/applications/$COKE_APP")
    [ "$S" = "403" ] || [ "$S" = "404" ] && ok "pepsi-admin read Coca-Cola application -> $S (not visible)" ||
      bad "pepsi-admin read Coca-Cola application (got $S)"
  else
    unk "pepsi-admin read Coca-Cola — no cocacola application row found to probe"
  fi
else
  unk "pepsi-admin tenant read — no session"
fi

# ── 8 — pepsi-admin calling Vault directly for Coca-Cola -> DENY ────────
# Namespace boundary, not an Arcanium check — reuses scenarios/06's proven pattern.
if [ -f .env.workloads ]; then
  set -a
  . ./.env.workloads
  set +a
  if [ -n "${PEPSI_VAULT_ROLE_ID:-}" ] && [ -n "${PEPSI_VAULT_SECRET_ID:-}" ] && command -v vault >/dev/null 2>&1; then
    export VAULT_CACERT="$(pwd)/vault-tls/ca-chain.pem"
    PEPSI_TOKEN=$(VAULT_ADDR=https://127.0.0.1:18200 VAULT_NAMESPACE=suppliers/pepsi vault write -field=token \
      auth/approle/login role_id="$PEPSI_VAULT_ROLE_ID" secret_id="$PEPSI_VAULT_SECRET_ID" 2>/dev/null)
    if [ -n "$PEPSI_TOKEN" ]; then
      S=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Vault-Token: $PEPSI_TOKEN" \
        -H "X-Vault-Namespace: suppliers/cocacola" -X LIST --cacert vault-tls/ca-chain.pem \
        "https://127.0.0.1:18200/v1/transit/keys")
      [ "$S" = "403" ] && ok "pepsi-admin Vault-direct LIST cocacola transit/keys -> DENY (403)" ||
        bad "pepsi-admin Vault-direct cross-tenant access (got $S)"
    else
      unk "pepsi-admin Vault-direct check — could not mint a pepsi AppRole token"
    fi
  else
    unk "pepsi-admin Vault-direct check — PEPSI_VAULT_ROLE_ID/SECRET_ID not set (run scenarios/06_supplier_isolation/provision.sh first)"
  fi
else
  unk "pepsi-admin Vault-direct check — .env.workloads not found (run scenarios/06_supplier_isolation/provision.sh first)"
fi

# ── 12/13 — wrong issuer / wrong audience -> rejected ────────────────────
if $STACK_UP && command -v node >/dev/null 2>&1; then
  IFS='|' read -r RAW_CODE RAW_VERIFIER < <(raw_authorize_get_code demo-operator "Arcanium-ops-2026" 2>/dev/null || echo "")
  if [ -n "${RAW_CODE:-}" ]; then
    if node "$(dirname "$0")/check_token_validation.mjs" issuer "$RAW_CODE" "$RAW_VERIFIER" "$ARCANIUM_API_CALLBACK_URL" >/tmp/arc11-issuer.log 2>&1; then
      ok "wrong issuer on token exchange -> rejected (see check_token_validation.mjs)"
    else
      bad "wrong issuer on token exchange — not rejected (see /tmp/arc11-issuer.log)"
    fi
  else
    unk "wrong issuer check — could not obtain a real authorization code"
  fi

  IFS='|' read -r RAW_CODE2 RAW_VERIFIER2 < <(raw_authorize_get_code demo-operator "Arcanium-ops-2026" 2>/dev/null || echo "")
  if [ -n "${RAW_CODE2:-}" ]; then
    if node "$(dirname "$0")/check_token_validation.mjs" audience "$RAW_CODE2" "$RAW_VERIFIER2" "$ARCANIUM_API_CALLBACK_URL" >/tmp/arc11-audience.log 2>&1; then
      ok "wrong audience (unregistered client) on token exchange -> rejected (see check_token_validation.mjs)"
    else
      bad "wrong audience check — not rejected (see /tmp/arc11-audience.log)"
    fi
  else
    unk "wrong audience check — could not obtain a real authorization code"
  fi
else
  unk "wrong issuer -> rejected — identity stack/node not reachable"
  unk "wrong audience -> rejected — identity stack/node not reachable"
fi

# ── Prompt 19 — close_authorization_gaps: the 6 previously-unwired routes ──
# Fixture ids read live from the running stack rather than hardcoded —
# resilient to reseeding, and fails UNKNOWN (not a false PASS) if the demo
# data this suite depends on isn't present.
COKE_SUPPLIER=$(podman exec arcanium-postgres psql -U "${POSTGRES_USER:-arcanium}" -d "${POSTGRES_DB:-arcanium_db}" -tA \
  -c "SELECT id FROM suppliers WHERE vault_namespace='suppliers/cocacola' LIMIT 1" 2>/dev/null | tr -d '[:space:]')
[ -z "${COKE_APP:-}" ] && COKE_APP=$(podman exec arcanium-postgres psql -U "${POSTGRES_USER:-arcanium}" -d "${POSTGRES_DB:-arcanium_db}" -tA \
  -c "SELECT a.id FROM applications a JOIN suppliers s ON s.id=a.supplier_id WHERE s.vault_namespace='suppliers/cocacola' LIMIT 1" 2>/dev/null | tr -d '[:space:]')
ANY_ACCESSOR=$(podman exec arcanium-postgres psql -U "${POSTGRES_USER:-arcanium}" -d "${POSTGRES_DB:-arcanium_db}" -tA \
  -c "SELECT accessor FROM approval_requests WHERE accessor IS NOT NULL AND accessor <> '' LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# ── auditor PATCH/DELETE suppliers/:id -> 403 ───────────────────────────
if session_ok "${JAR[auditor]}" && [ -n "$COKE_SUPPLIER" ]; then
  S=$(status_of -X PATCH -b "${JAR[auditor]}" -H 'content-type: application/json' \
    -d '{"sla_tier":"gold"}' "$API/api/v1/suppliers/$COKE_SUPPLIER")
  [ "$S" = "403" ] && ok "auditor PATCH /suppliers/:id -> 403" || bad "auditor PATCH /suppliers/:id (got $S)"

  S=$(status_of -X DELETE -b "${JAR[auditor]}" "$API/api/v1/suppliers/$COKE_SUPPLIER")
  [ "$S" = "403" ] && ok "auditor DELETE /suppliers/:id -> 403" || bad "auditor DELETE /suppliers/:id (got $S)"
else
  unk "auditor PATCH /suppliers/:id — no session or no supplier fixture"
  unk "auditor DELETE /suppliers/:id — no session or no supplier fixture"
fi

# ── auditor PATCH/DELETE applications/:id -> 403 ────────────────────────
if session_ok "${JAR[auditor]}" && [ -n "$COKE_APP" ]; then
  S=$(status_of -X PATCH -b "${JAR[auditor]}" -H 'content-type: application/json' \
    -d '{"description":"auditor should not be able to set this"}' "$API/api/v1/applications/$COKE_APP")
  [ "$S" = "403" ] && ok "auditor PATCH /applications/:id -> 403" || bad "auditor PATCH /applications/:id (got $S)"

  S=$(status_of -X DELETE -b "${JAR[auditor]}" "$API/api/v1/applications/$COKE_APP")
  [ "$S" = "403" ] && ok "auditor DELETE /applications/:id -> 403" || bad "auditor DELETE /applications/:id (got $S)"
else
  unk "auditor PATCH /applications/:id — no session or no application fixture"
  unk "auditor DELETE /applications/:id — no session or no application fixture"
fi

# ── architect POST /approvals/:accessor/authorize -> 403 ────────────────
# 'approve' is CISO-only in the matrix; architect must be denied even
# against a real accessor (status doesn't matter — role is checked first).
if session_ok "${JAR[architect]}" && [ -n "$ANY_ACCESSOR" ]; then
  S=$(status_of -X POST -b "${JAR[architect]}" -H 'content-type: application/json' \
    -d '{}' "$API/api/v1/approvals/$ANY_ACCESSOR/authorize")
  [ "$S" = "403" ] && ok "architect POST /approvals/:accessor/authorize -> 403" ||
    bad "architect POST /approvals/:accessor/authorize (got $S)"
else
  unk "architect POST /approvals/:accessor/authorize — no session or no approval-request fixture"
fi

# ── pepsi-admin cross-tenant PATCH/DELETE on cocacola's resources ───────
if session_ok "${JAR[pepsi]}" && [ -n "$COKE_SUPPLIER" ]; then
  S=$(status_of -X PATCH -b "${JAR[pepsi]}" -H 'content-type: application/json' \
    -d '{"sla_tier":"gold"}' "$API/api/v1/suppliers/$COKE_SUPPLIER")
  { [ "$S" = "403" ] || [ "$S" = "404" ]; } && ok "pepsi-admin PATCH cocacola's supplier -> $S" ||
    bad "pepsi-admin PATCH cocacola's supplier (got $S)"
else
  unk "pepsi-admin PATCH cocacola's supplier — no session or no supplier fixture"
fi

if session_ok "${JAR[pepsi]}" && [ -n "$COKE_APP" ]; then
  S=$(status_of -X DELETE -b "${JAR[pepsi]}" "$API/api/v1/applications/$COKE_APP")
  { [ "$S" = "403" ] || [ "$S" = "404" ]; } && ok "pepsi-admin DELETE cocacola's application -> $S" ||
    bad "pepsi-admin DELETE cocacola's application (got $S)"
else
  unk "pepsi-admin DELETE cocacola's application — no session or no application fixture"
fi

rm -f "${JAR[@]}" 2>/dev/null

TOTAL=$((PASS + FAIL + UNKNOWN))
echo
echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $TOTAL) =="
[ "$FAIL" -eq 0 ]
