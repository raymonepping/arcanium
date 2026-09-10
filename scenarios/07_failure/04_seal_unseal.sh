#!/usr/bin/env bash
# scenarios/07_failure/04_seal_unseal.sh
# Scenario: vault-s is sealed (simulating a security incident response).
# vault-1/2/3 continue because they use transit auto-unseal via vault-s —
# once a node is already unsealed it does NOT re-seal when vault-s is sealed.
# vault-s must be manually unsealed using its Shamir key.

set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
# shellcheck source=scripts/vault-common.sh
source "${REPO_ROOT}/scripts/vault-common.sh"

SECRETS_DIR="${REPO_ROOT}/.secrets/vault"

# ── helpers ──────────────────────────────────────────────────────────────────
section() {
  echo ""
  echo "══════════════════════════════════════════"
  echo "  $*"
  echo "══════════════════════════════════════════"
}

# ── main ─────────────────────────────────────────────────────────────────────
section "Arcanium Resilience Demo: Seal / Unseal vault-s"
echo "vault-s is sealed → vault-1/2/3 unaffected (already unsealed in memory)"
echo "Unseal vault-s with its Shamir key share"
echo ""

section "Step 1 — Baseline cluster health"
make -C "${REPO_ROOT}" vault-status || true

section "Step 2 — Sealing vault-s"
vault_node vault-s
vault_root vault-s
VAULT_ADDR=https://127.0.0.1:18190 vault operator seal
echo "  vault-s sealed"

section "Step 3 — vault-s status (should show sealed: true)"
sleep 2
vault_node vault-s
set +e
VSEAL=$(VAULT_ADDR=https://127.0.0.1:18190 vault status -format=json 2>/dev/null || echo '{}')
set -e
echo "${VSEAL}" | jq '{sealed,initialized}' 2>/dev/null || echo "  (no status — sealed nodes may not respond to status)"

section "Step 4 — vault-1 still operational (auto-unseal node, already unsealed)"
vault_node vault-1
vault_root cluster
V1STATUS=$(VAULT_ADDR=https://127.0.0.1:18200 vault status -format=json 2>/dev/null)
echo "${V1STATUS}" | jq '{initialized,sealed,ha_enabled}'
SEALED=$(echo "${V1STATUS}" | jq -r '.sealed')
if [ "${SEALED}" = "false" ]; then
  echo "  ✓ vault-1 is unsealed — crypto operations continue"
else
  echo "  ✗ vault-1 appears sealed — unexpected"
fi

section "Step 5 — Unsealing vault-s"
INIT_FILE="${SECRETS_DIR}/vault-s-init.json"
if [ ! -f "${INIT_FILE}" ]; then
  echo "  ✗ Init file not found: ${INIT_FILE}"
  echo "    Manually run: vault operator unseal <key>"
  exit 1
fi

KEY=$(jq -r '.unseal_keys_b64[0]' "${INIT_FILE}")
vault_node vault-s
VAULT_ADDR=https://127.0.0.1:18190 vault operator unseal "${KEY}"
unset KEY
echo "  vault-s unseal key applied"

section "Step 6 — Final cluster state"
sleep 5
make -C "${REPO_ROOT}" vault-status || true

echo ""
echo "  Demo complete. vault-s is unsealed; the full cluster is operational."
