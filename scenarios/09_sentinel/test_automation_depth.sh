#!/usr/bin/env bash
# scenarios/09_sentinel/test_automation_depth.sh — Prompt 17
#
# Proves the rotation-from-automation Sentinel EGP is live:
#   Test 1 — a human token (transit write, no automation policy) is DENIED rotation
#   Test 2 — an automation token (transit write + automation policy)  is ALLOWED
#
# Requires the Sentinel licence feature.  Safe to run repeatedly.

set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
# shellcheck source=scripts/vault-common.sh
source "${REPO_ROOT}/scripts/vault-common.sh"

# ── helpers ──────────────────────────────────────────────────────────────────
section() {
  echo ""
  echo "══════════════════════════════════════════"
  echo "  $*"
  echo "══════════════════════════════════════════"
}
pass() { echo "  ✓ PASS — $*"; }
fail() {
  echo "  ✗ FAIL — $*"
  FAILED=1
}
FAILED=0

# ── licence check ─────────────────────────────────────────────────────────────
if ! "${REPO_ROOT}/scripts/vault-check-entitlement.sh" "Sentinel" 2>/dev/null; then
  echo "SKIP — Sentinel not in licence; tf-sentinel cannot be applied"
  exit 0
fi

vault_node vault-1
vault_root cluster

section "Check: rotation-from-automation EGP exists"
# EGPs live under sys/policies/egp — `vault policy list` only shows ACL policies.
if VAULT_ADDR=https://127.0.0.1:18200 vault list sys/policies/egp 2>/dev/null |
  grep -q "rotation-from-automation"; then
  pass "rotation-from-automation EGP is registered"
else
  fail "rotation-from-automation EGP NOT found — run: make tf-sentinel"
  exit 1
fi

section "Setup: create throwaway tokens"
# Human token: can write to transit (via payments-api-policy), no automation marker
HUMAN_TOK=$(VAULT_ADDR=https://127.0.0.1:18200 \
  vault token create -policy=payments-api-policy -field=token 2>/dev/null)
# Automation token: same ACL rights + automation marker policy
AUTO_TOK=$(VAULT_ADDR=https://127.0.0.1:18200 \
  vault token create -policy=payments-api-policy -policy=automation -field=token 2>/dev/null)
echo "  Human token:     ${HUMAN_TOK:0:12}..."
echo "  Automation token: ${AUTO_TOK:0:12}..."

section "Test 1 — human token rotates payments-api-key (expect: DENIED by Sentinel)"
set +e
RESULT=$(VAULT_ADDR=https://127.0.0.1:18200 VAULT_TOKEN="${HUMAN_TOK}" \
  vault write -f transit/keys/payments-api-key/rotate 2>&1)
set -e
echo "  Response: ${RESULT}"
if echo "${RESULT}" | grep -qiE "permission denied|egp|sentinel"; then
  pass "EGP blocked human token rotation"
else
  fail "expected Sentinel denial — EGP may not be applied or the policy path is wrong"
fi

section "Test 2 — automation token rotates payments-api-key (expect: ALLOWED)"
set +e
RESULT=$(VAULT_ADDR=https://127.0.0.1:18200 VAULT_TOKEN="${AUTO_TOK}" \
  vault write -f transit/keys/payments-api-key/rotate 2>&1)
set -e
echo "  Response: ${RESULT}"
if echo "${RESULT}" | grep -qiE "permission denied|egp|sentinel"; then
  fail "automation token was denied — check that automation policy is in its token_policies"
else
  pass "automation token was allowed to rotate"
fi

section "Cleanup: revoke throwaway tokens"
VAULT_ADDR=https://127.0.0.1:18200 vault token revoke "${HUMAN_TOK}" 2>/dev/null || true
VAULT_ADDR=https://127.0.0.1:18200 vault token revoke "${AUTO_TOK}" 2>/dev/null || true
echo "  tokens revoked"

echo ""
if [ "${FAILED}" -eq 0 ]; then
  echo "  All tests passed — rotation-from-automation EGP is enforcing correctly."
  echo "  Automation Depth dimension will score 100 on next maturity check."
else
  echo "  One or more tests failed — see output above."
  exit 1
fi
