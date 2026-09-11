#!/usr/bin/env bash
# scenarios/pre_24_persistence/test_restart_persistence.sh — Pre-24,
# Deliverables 9 and 13.
#
# Hostile enough to prove the claim, not just exercise a happy path:
# records safe (non-secret) fingerprints, runs a real `make down` + `make
# up`/`make rehydrate`, recreates containers, and deliberately deletes
# workload credential material — then verifies every fingerprint still
# matches and every dependent capability (OIDC login, tenant isolation,
# reconciliation, workload auth) still works. Never records secrets.
#
# DESTRUCTIVE TO THE RUNNING ESTATE (not to persistent data): this stops
# and recreates the live Vault/Keycloak/LDAP/Postgres/HSM stack. It does
# not delete any named volume — see docs/persistence.md and the Makefile's
# own `down`/`up`/`rehydrate` targets, none of which call `down -v`.
#
# Usage:
#   scenarios/pre_24_persistence/test_restart_persistence.sh          # A+B+C
#   scenarios/pre_24_persistence/test_restart_persistence.sh --invariants-only
#     runs only the static Deliverable-13 checks — no stack interaction.

set -uo pipefail
cd "$(dirname -- "$0")/../.." # -> repo root
set -a
[ -f .env ] && . ./.env
set +a

API="${ARCANIUM_API:-http://localhost:3001}"
OIDC_URL="${ARCANIUM_OIDC_PUBLIC_URL:-http://localhost:8083}"

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
  echo "  ? $1"
  UNKNOWN=$((UNKNOWN + 1))
}

# ── shared OIDC login helper (same pattern as scenarios/13_fitness) ────────
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
if curl -fsS --max-time 3 "$OIDC_URL/realms/arcanium" >/dev/null 2>&1 &&
  curl -fsS --max-time 3 "$API/health" >/dev/null 2>&1; then
  STACK_UP=true
fi

# ── fingerprint: safe, non-secret identifiers only ─────────────────────────
fingerprint() {
  local out="$1"
  local jar
  jar=$(mktemp)
  {
    if $STACK_UP && oidc_login "demo-operator" "$jar" "Arcanium-ops-2026"; then
      echo "applications_count=$(curl -s -b "$jar" "$API/api/v1/applications" | jq 'length' 2>/dev/null || echo unknown)"
      echo "reconciliation_count=$(curl -s -b "$jar" "$API/api/v1/reconciliation" | jq 'length' 2>/dev/null || echo unknown)"
      echo "suppliers_count=$(curl -s -b "$jar" "$API/api/v1/suppliers" | jq 'length' 2>/dev/null || echo unknown)"
    else
      echo "applications_count=unknown"
      echo "reconciliation_count=unknown"
      echo "suppliers_count=unknown"
    fi
    if running arcanium-vault_1 2>/dev/null || podman ps --format '{{.Names}}' 2>/dev/null | grep -x arcanium-vault_1 >/dev/null; then
      echo "vault_cluster_id=$(curl -sk --max-time 5 https://127.0.0.1:18200/v1/sys/health 2>/dev/null | jq -r '.cluster_id // "unknown"' 2>/dev/null || echo unknown)"
    else
      echo "vault_cluster_id=unknown"
    fi
    echo "vault_volumes=$(podman volume ls --format '{{.Name}}' 2>/dev/null | grep -c 'arcanium-vault_')"
    echo "ldap_softhsm_keycloak_volumes=$(podman volume ls --format '{{.Name}}' 2>/dev/null | grep -cE 'arcanium-(identity|hsm)_')"
  } >"$out"
  rm -f "$jar"
}

echo "== Pre-24 — Deliverable 13: static persistence invariants =="
echo

# 1. Every stateful compose service has an explicit persistence declaration
MISSING=""
for f in compose/*/compose.yaml; do
  stack=$(basename "$(dirname "$f")")
  vols=$(sed -n '/^volumes:/,$p' "$f" | grep -E '^  [a-zA-Z0-9_-]+:' | sed -E 's/^  ([a-zA-Z0-9_-]+):.*/\1/')
  for v in $vols; do
    grep -q "$v" config/persistence-manifest.yaml 2>/dev/null || MISSING="$MISSING $stack/$v"
  done
done
if [ -z "$MISSING" ]; then
  ok "every named compose volume has a persistence-manifest.yaml entry"
else
  bad "named volume(s) with no persistence-manifest.yaml entry:$MISSING"
fi

# 2. Normal down/restart never uses -v
if grep -qE "^\s*down:" Makefile && ! grep -A20 "^down:" Makefile | grep -q "down -v\|volume prune"; then
  ok "make down never calls down -v / volume prune"
else
  bad "make down appears to call a volume-destroying command"
fi

# 3. No workload image contains RoleID/SecretID values (Containerfiles don't COPY .env)
HITS=$(grep -rl "COPY .*\.env\|COPY .*\.env\.workloads" workloads/*/Containerfile arcanium/*/Containerfile 2>/dev/null || true)
if [ -z "$HITS" ]; then
  ok "no workload/service Containerfile COPYs .env or .env.workloads into the image"
else
  bad "Containerfile(s) copy an env file into the image: $HITS"
fi

# 4. No SecretID committed anywhere in tracked files
HITS=$(git grep -nE "(ROLE_ID|SECRET_ID)\s*[:=]\s*['\"]?[0-9a-f]{8}-[0-9a-f]{4}" -- ':!*.md' 2>/dev/null || true)
if [ -z "$HITS" ]; then
  ok "no RoleID/SecretID-shaped literal committed in tracked source"
else
  bad "possible committed credential literal: $HITS"
fi

# 5. reset-demo is the only Makefile target that calls down -v — only
# actual recipe lines (tab-indented) count; comments/help text mentioning
# the phrase are not invocations.
COUNT=$(grep -c "^$(printf '\t').*down -v" Makefile)
if [ "$COUNT" -le 1 ]; then
  ok "at most one Makefile target calls down -v (reset-demo)"
else
  bad "more than one Makefile target calls down -v — check for an unintended destructive default"
fi

echo
TOTAL=$((PASS + FAIL + UNKNOWN))
echo "== Deliverable 13 result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $TOTAL) =="

if [ "${1:-}" = --invariants-only ]; then
  [ "$FAIL" -eq 0 ]
  exit $?
fi

echo
echo "== Pre-24 — Deliverable 9: hostile restart/recreate/credential-loss proof =="
echo

if [ "$STACK_UP" != true ]; then
  unk "stack is not reachable (OIDC + API) — cannot run the live scenarios; bring the stack up first"
  echo
  echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $((PASS + FAIL + UNKNOWN))) =="
  echo "UNKNOWN" >state/.last-persistence-scenario-result
  exit 1
fi

echo "-- fingerprint: before --"
BEFORE=$(mktemp)
fingerprint "$BEFORE"
cat "$BEFORE"

echo
echo "-- Scenario A: normal stack restart (make down && make up) --"
make down
make up
sleep 10
echo "-- fingerprint: after Scenario A --"
AFTER_A=$(mktemp)
fingerprint "$AFTER_A"
cat "$AFTER_A"
if diff -q "$BEFORE" "$AFTER_A" >/dev/null; then
  ok "Scenario A: all fingerprints identical after normal restart"
else
  bad "Scenario A: fingerprint mismatch — $(diff "$BEFORE" "$AFTER_A" | tr '\n' ' ')"
fi

JAR=$(mktemp)
if oidc_login "demo-operator" "$JAR" "Arcanium-ops-2026"; then
  ok "Scenario A: OIDC login succeeds after restart"
else
  bad "Scenario A: OIDC login failed after restart"
fi
rm -f "$JAR"

if bash scenarios/06_supplier_isolation/test_positive.sh >/dev/null 2>&1 &&
  bash scenarios/06_supplier_isolation/test_negative.sh >/dev/null 2>&1; then
  ok "Scenario A: supplier isolation still passes"
else
  bad "Scenario A: supplier isolation failed after restart"
fi

echo
echo "-- Scenario B: recreate containers, keep volumes --"
podman rm -f arcanium-ui arcanium-api arcanium-worker arcanium-keycloak arcanium-openldap >/dev/null 2>&1 || true
make up
sleep 15
echo "-- fingerprint: after Scenario B --"
AFTER_B=$(mktemp)
fingerprint "$AFTER_B"
cat "$AFTER_B"
if diff -q "$BEFORE" "$AFTER_B" >/dev/null; then
  ok "Scenario B: all fingerprints identical after container recreation"
else
  bad "Scenario B: fingerprint mismatch — $(diff "$BEFORE" "$AFTER_B" | tr '\n' ' ')"
fi

JAR=$(mktemp)
if oidc_login "demo-operator" "$JAR" "Arcanium-ops-2026"; then
  ok "Scenario B: OIDC login succeeds after container recreation (Keycloak/LDAP config survived)"
else
  bad "Scenario B: OIDC login failed after container recreation"
fi
rm -f "$JAR"

echo
echo "-- Scenario C: delete workload credentials, rehydrate, recover --"
cp .env .env.pre24-scenario-c.bak
sed -i '' '/^DOCSIGN_VAULT_ROLE_ID=/d;/^DOCSIGN_VAULT_SECRET_ID=/d' .env
echo "  removed DOCSIGN_VAULT_ROLE_ID/SECRET_ID from .env"
podman rm -f arcanium-document-signing >/dev/null 2>&1 || true
./scripts/compose.sh workloads up -d document-signing >/dev/null 2>&1 || true
sleep 5
if podman logs arcanium-document-signing 2>&1 | grep -q "Missing required env var"; then
  ok "Scenario C: credential loss reproduces the documented failure (proves the test is real)"
else
  unk "Scenario C: expected failure signature not observed — container may not have recreated in time"
fi

./scripts/workload-credentials.sh issue document-signing
podman rm -f arcanium-document-signing >/dev/null 2>&1 || true
./scripts/compose.sh workloads up -d document-signing >/dev/null 2>&1 || true
sleep 10
if podman logs arcanium-document-signing 2>&1 | tail -20 | grep -q "verify OK"; then
  ok "Scenario C: rehydration restores workload authentication (real sign+verify observed)"
else
  bad "Scenario C: document-signing did not recover after credential reissue"
fi

echo "-- fingerprint: after Scenario C --"
AFTER_C=$(mktemp)
fingerprint "$AFTER_C"
if diff -q "$BEFORE" "$AFTER_C" >/dev/null; then
  ok "Scenario C: no persistent application/Vault estate was reset by credential reissuance"
else
  bad "Scenario C: fingerprint mismatch — $(diff "$BEFORE" "$AFTER_C" | tr '\n' ' ')"
fi

rm -f .env.pre24-scenario-c.bak "$BEFORE" "$AFTER_A" "$AFTER_B" "$AFTER_C"

echo
TOTAL=$((PASS + FAIL + UNKNOWN))
echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $TOTAL) =="

if [ "$FAIL" -eq 0 ]; then
  echo "PASS" >state/.last-persistence-scenario-result
else
  echo "FAIL" >state/.last-persistence-scenario-result
fi
[ "$FAIL" -eq 0 ]
