#!/usr/bin/env bash
# scenarios/07_failure/03_quorum_loss.sh
# ⚠ WARNING — EDUCATIONAL ONLY
# Stops 2 of 3 Raft cluster nodes (vault-2 + vault-3).
# Vault WILL become unavailable until restored.
# Demonstrates what happens when quorum is lost — auto-restores after 30 s.

set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
# shellcheck source=scripts/vault-common.sh
source "${REPO_ROOT}/scripts/vault-common.sh"

ARCANIUM_API="${ARCANIUM_API:-http://localhost:3001}"

# ── helpers ──────────────────────────────────────────────────────────────────
section() {
  echo ""
  echo "══════════════════════════════════════════"
  echo "  $*"
  echo "══════════════════════════════════════════"
}

# ── confirmation ─────────────────────────────────────────────────────────────
section "⚠  Arcanium Demo: Quorum Loss (Educational)"
echo ""
echo "  This stops vault-2 AND vault-3."
echo "  Vault WILL become unavailable. Auto-restores in 30 s."
echo ""
read -r -p "  Type YES to continue: " CONFIRM
if [ "${CONFIRM}" != "YES" ]; then
  echo "  Aborted."
  exit 0
fi

# ── main ─────────────────────────────────────────────────────────────────────
section "Step 1 — Baseline"
make -C "${REPO_ROOT}" vault-status || true

section "Step 2 — Stopping vault-2 AND vault-3 (quorum lost)"
podman stop arcanium-vault-2 arcanium-vault-3
echo "  vault-2 and vault-3 stopped"

section "Step 3 — Attempting crypto operation (expect failure)"
sleep 3
vault_node vault-1
vault_root cluster
set +e # we expect failure below
OP_RESULT=$(VAULT_ADDR=https://127.0.0.1:18200 \
  vault write -field=ciphertext transit/encrypt/payments-key \
  plaintext="$(echo -n 'quorum-loss-test' | base64)" 2>&1)
OP_EXIT=$?
set -e
if [ "${OP_EXIT}" -ne 0 ]; then
  echo "  ✓ Expected failure: ${OP_RESULT}"
else
  echo "  ⚠ Operation unexpectedly succeeded: ${OP_RESULT}"
fi

section "Step 4 — API health (expect unhealthy)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${ARCANIUM_API}/health" 2>/dev/null || echo "000")
echo "  arcanium-api /health → HTTP ${HTTP_CODE}  (503 or timeout expected)"

section "Step 5 — Auto-restoring in 30 s"
for i in $(seq 30 -1 1); do
  printf "\r  Restoring in %2d s..." "${i}"
  sleep 1
done
echo ""
podman start arcanium-vault-2 arcanium-vault-3
echo "  vault-2 and vault-3 started — waiting 20 s for Raft rejoin..."
sleep 20

section "Step 6 — Cluster after recovery"
make -C "${REPO_ROOT}" vault-status || true

echo ""
echo "  Demo complete. This scenario illustrates why ≥ 3 nodes and quorum matter."
