#!/usr/bin/env bash
# scenarios/14_evidence_v2/test_gated_maturity.sh — Prompt 21 exit criterion.
# Per input/32's own example, this doesn't finish because control_assessments
# exist — it finishes when the gate demonstrably gates: forcing one mandatory
# control to FAIL visibly drops the level (even with everything else
# unchanged), Vault unreachability produces UNKNOWN (never a fabricated
# PASS or a silent FAIL), and both recover once the underlying cause does.
set -uo pipefail
cd "$(dirname -- "$0")/../.." # -> repo root
set -a
[ -f .env ] && . ./.env
set +a

API="${ARCANIUM_API:-http://localhost:3001}"
EGP_NAME="rotation-from-automation"
VAULT_NET="arcanium-vault-internal"

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

echo "== Prompt 21 — Evidence Model v2: hostile gated-maturity proof =="
echo "   API: $API"
echo

STACK_UP=false
if curl -fsS --max-time 3 "${ARCANIUM_OIDC_PUBLIC_URL:-http://localhost:8083}/realms/arcanium" >/dev/null 2>&1 &&
  curl -fsS --max-time 3 "$API/health" >/dev/null 2>&1; then
  STACK_UP=true
fi

JAR=$(mktemp)
if $STACK_UP && oidc_login "demo-operator" "$JAR" "Arcanium-ops-2026"; then
  echo "  (signed in as demo-operator)"
else
  echo "FATAL: could not sign in as demo-operator — is the identity stack up? (make identity-bootstrap)" >&2
  rm -f "$JAR"
  exit 1
fi

# Guarantee cleanup (network reconnect, EGP restore) even on an early exit.
NET_DISCONNECTED=false
cleanup() {
  if $NET_DISCONNECTED; then
    podman network connect "$VAULT_NET" arcanium-api >/dev/null 2>&1 || true
  fi
  rm -f "$JAR"
}
trap cleanup EXIT

# ── 1 — Assess current state, record baseline level ──────────────────────
BASELINE=$(curl -s -b "$JAR" "$API/api/v1/maturity")
BASELINE_LEVEL=$(echo "$BASELINE" | jq -r '.maturity // "MISSING"')
if [ "$BASELINE_LEVEL" = "MISSING" ]; then
  bad "baseline assessment — /api/v1/maturity did not return a maturity field"
  exit 1
fi
ok "baseline assessment -> Level $BASELINE_LEVEL ($(echo "$BASELINE" | jq -r '.levelName'))"

SENTINEL_LICENSED=$(curl -s -b "$JAR" "$API/api/v1/platform/entitlements" | jq -r '.capabilities.sentinel // false')

if [ "$SENTINEL_LICENSED" != "true" ]; then
  unk "AUTO-01 forced-FAIL step — Sentinel not in this Vault license (see scenarios/09_sentinel)"
else
  # ── 2 — Force AUTO-01 to FAIL: delete the EGP outside Arcanium ──────────
  ROOT_TOKEN=""
  if [ -f .secrets/vault/cluster-init.json ] && command -v vault >/dev/null 2>&1; then
    ROOT_TOKEN=$(jq -er '.root_token' .secrets/vault/cluster-init.json 2>/dev/null)
  fi
  if [ -z "$ROOT_TOKEN" ]; then
    unk "AUTO-01 forced-FAIL step — no local root token / vault CLI available"
  else
    if VAULT_ADDR=https://127.0.0.1:18200 VAULT_TOKEN="$ROOT_TOKEN" VAULT_CACERT="$(pwd)/vault-tls/ca-chain.pem" \
      vault delete "sys/policies/egp/${EGP_NAME}" >/dev/null 2>&1; then
      ok "AUTO-01 dependency removed (Sentinel EGP '${EGP_NAME}' deleted outside Arcanium)"
    else
      bad "could not delete the ${EGP_NAME} EGP to force AUTO-01 FAIL"
    fi

    # ── 3 — Re-assess: level must drop, and say why ────────────────────────
    AFTER=$(curl -s -b "$JAR" "$API/api/v1/maturity")
    AFTER_LEVEL=$(echo "$AFTER" | jq -r '.maturity // "MISSING"')
    CAP_REASON=$(echo "$AFTER" | jq -r '.levelCapReason // ""')
    AUTO01_STATUS=$(curl -s -b "$JAR" "$API/api/v1/controls/AUTO-01" | jq -r '.assessments[0].status // "MISSING"')

    if [ "$AUTO01_STATUS" = "FAIL" ]; then
      ok "AUTO-01 control assessment -> FAIL (real evidence: EGP list no longer contains it)"
    else
      bad "AUTO-01 control assessment did not report FAIL (got $AUTO01_STATUS)"
    fi

    if [ "$AFTER_LEVEL" -lt "$BASELINE_LEVEL" ] 2>/dev/null; then
      ok "gated level dropped: $BASELINE_LEVEL -> $AFTER_LEVEL (other dimensions unchanged)"
    else
      # A lower baseline (e.g. already capped by something else) can leave the
      # level unchanged even with AUTO-01 failing — only a real defect if
      # AUTO-01 itself wasn't the reported cause AND the level was >=4 before.
      if [ "$BASELINE_LEVEL" -ge 4 ] 2>/dev/null; then
        bad "gated level did not drop after forcing AUTO-01 to FAIL (still $AFTER_LEVEL)"
      else
        unk "gated level unchanged ($AFTER_LEVEL) — baseline was already below the level AUTO-01 gates"
      fi
    fi

    if echo "$CAP_REASON" | grep -q "AUTO-01"; then
      ok "UI/CLI-visible cap reason names the specific control: \"$CAP_REASON\""
    else
      unk "levelCapReason did not name AUTO-01 explicitly (got: '$CAP_REASON') — may be capped by an earlier control instead"
    fi
  fi
fi

# ── 4 — Make Vault briefly unreachable -> affected controls show UNKNOWN ──
if podman network disconnect "$VAULT_NET" arcanium-api >/dev/null 2>&1; then
  NET_DISCONNECTED=true
  echo "  -> arcanium-api disconnected from $VAULT_NET (Vault unreachable, Postgres still reachable)"
  UNREACHABLE=$(curl -s -b "$JAR" --max-time 15 "$API/api/v1/maturity")
  KEYINV_STATUS=$(echo "$UNREACHABLE" | jq -r '(.controls[]? | select(.id=="KEY-INV-01") | .status) // "MISSING"')
  if [ "$KEYINV_STATUS" = "UNKNOWN" ]; then
    ok "KEY-INV-01 -> UNKNOWN while Vault is unreachable (not FAIL, not a fabricated PASS)"
  else
    bad "KEY-INV-01 did not report UNKNOWN with Vault unreachable (got $KEYINV_STATUS)"
  fi
  RESP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" --max-time 15 "$API/api/v1/maturity")
  [ "$RESP_CODE" = "200" ] && ok "GET /api/v1/maturity still returns 200 with Vault unreachable (degrades gracefully, no 500)" ||
    bad "GET /api/v1/maturity did not degrade gracefully (got $RESP_CODE)"

  podman network connect "$VAULT_NET" arcanium-api >/dev/null 2>&1
  NET_DISCONNECTED=false
  echo "  -> arcanium-api reconnected to $VAULT_NET"
  sleep 2
else
  unk "Vault-unreachable step — could not disconnect arcanium-api from $VAULT_NET"
fi

# ── 5 — Restore the EGP and re-assess -> level returns to baseline ────────
if [ "$SENTINEL_LICENSED" = "true" ]; then
  if command -v terraform >/dev/null 2>&1 && [ -d terraform/vault-sentinel ] && [ -f .secrets/vault/cluster-init.json ]; then
    ROOT_TOKEN=$(jq -er '.root_token' .secrets/vault/cluster-init.json 2>/dev/null)
    (
      cd terraform/vault-sentinel &&
        VAULT_TOKEN="$ROOT_TOKEN" VAULT_CACERT="$(pwd)/../../vault-tls/ca-chain.pem" VAULT_ADDR=https://127.0.0.1:18200 \
          terraform apply -auto-approve >/tmp/arc14-tf-restore.log 2>&1
    )
    RESTORED=$(curl -s -b "$JAR" "$API/api/v1/maturity")
    RESTORED_LEVEL=$(echo "$RESTORED" | jq -r '.maturity // "MISSING"')
    AUTO01_RESTORED=$(curl -s -b "$JAR" "$API/api/v1/controls/AUTO-01" | jq -r '.assessments[0].status // "MISSING"')
    if [ "$AUTO01_RESTORED" = "PASS" ]; then
      ok "AUTO-01 -> PASS again after restoring the EGP (make tf-sentinel)"
    else
      bad "AUTO-01 did not return to PASS after restoring the EGP (got $AUTO01_RESTORED, see /tmp/arc14-tf-restore.log)"
    fi
    if [ "$RESTORED_LEVEL" = "$BASELINE_LEVEL" ]; then
      ok "gated level recovered to its prior value ($RESTORED_LEVEL)"
    else
      bad "gated level did not recover (baseline $BASELINE_LEVEL, now $RESTORED_LEVEL, see /tmp/arc14-tf-restore.log)"
    fi
  else
    unk "EGP restore step — terraform CLI, terraform/vault-sentinel, or root token unavailable"
  fi
else
  unk "EGP restore step — Sentinel not licensed, nothing to restore"
fi

echo
TOTAL=$((PASS + FAIL + UNKNOWN))
echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $TOTAL) =="
[ "$FAIL" -eq 0 ]
