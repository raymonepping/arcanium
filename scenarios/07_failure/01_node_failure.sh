#!/usr/bin/env bash
# scenarios/07_failure/01_node_failure.sh
# Scenario: vault-2 fails. Raft retains quorum (vault-1 + vault-3 = 2 of 3).
# Expected: crypto operations continue uninterrupted; cluster shows degraded state.
# Restores vault-2 automatically.

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
check_crypto() {
  local before_count after_count
  before_count=$(curl -sf "${ARCANIUM_API}/api/v1/evidence" 2>/dev/null | jq 'length' 2>/dev/null || echo "unknown")
  echo "  Evidence records before: ${before_count}"
  sleep 10
  after_count=$(curl -sf "${ARCANIUM_API}/api/v1/evidence" 2>/dev/null | jq 'length' 2>/dev/null || echo "unknown")
  echo "  Evidence records after:  ${after_count}"
  if [ "${before_count}" != "unknown" ] && [ "${after_count}" != "unknown" ] && [ "${after_count}" -ge "${before_count}" ]; then
    echo "  ✓ Crypto operations continued (evidence accumulating)"
  else
    echo "  ⚠ Could not confirm live crypto (workloads may be paused)"
  fi
}

# ── main ─────────────────────────────────────────────────────────────────────
section "Arcanium Resilience Demo: Single Node Failure"
echo "vault-2 stops → Raft quorum remains (vault-1 + vault-3) → service unaffected"
echo ""

section "Step 1 — Baseline cluster health"
make -C "${REPO_ROOT}" vault-status || true

section "Step 2 — Stopping vault-2"
podman stop arcanium-vault-2
echo "  vault-2 stopped"

section "Step 3 — Cluster status after failure (allow 5 s for Raft to detect)"
sleep 5
vault_node vault-1
vault_root cluster
echo ""
echo "  Raft peers view:"
VAULT_ADDR=https://127.0.0.1:18200 vault operator raft list-peers -format=json 2>/dev/null |
  jq -r '.data.config.servers[] | "    \(.node_id)  leader=\(.leader)  voter=\(.voter)"' || echo "  (could not list peers)"

section "Step 4 — Confirming crypto operations still work"
check_crypto

section "Step 5 — Restoring vault-2"
podman start arcanium-vault-2
echo "  vault-2 started — waiting 15 s for Raft rejoin..."
sleep 15

section "Step 6 — Cluster after recovery"
make -C "${REPO_ROOT}" vault-status || true

echo ""
echo "  Demo complete. Cluster should be fully healthy."
echo "  Grafana → Vault Cluster dashboard shows the gap and recovery."
