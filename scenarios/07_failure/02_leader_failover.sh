#!/usr/bin/env bash
# scenarios/07_failure/02_leader_failover.sh
# Scenario: The current active Raft leader is stopped.
# Expected: brief pause (< 10 s) while a new leader is elected, then operations resume.
# Restores the original leader automatically.

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

# Map a Vault node_id (address suffix) back to a container name + host port.
# cluster nodes are vault-1 (18200), vault-2 (18201), vault-3 (18202).
container_for_addr() {
  case "$1" in
  *vault-1*) echo "arcanium-vault-1" ;;
  *vault-2*) echo "arcanium-vault-2" ;;
  *vault-3*) echo "arcanium-vault-3" ;;
  *) echo "" ;;
  esac
}

addr_port_for_container() {
  case "$1" in
  arcanium-vault-1) echo "18200" ;;
  arcanium-vault-2) echo "18201" ;;
  arcanium-vault-3) echo "18202" ;;
  esac
}

# ── main ─────────────────────────────────────────────────────────────────────
section "Arcanium Resilience Demo: Leader Failover"
echo "Active Raft leader is stopped → election → new leader → operations resume"
echo ""

section "Step 1 — Identify current leader"
vault_node vault-1
vault_root cluster

LEADER_ADDR=$(VAULT_ADDR=https://127.0.0.1:18200 vault operator raft list-peers -format=json 2>/dev/null |
  jq -r '.data.config.servers[] | select(.leader==true) | .address' || echo "")

if [ -z "${LEADER_ADDR}" ]; then
  echo "  ✗ Could not determine leader. Is the cluster up?"
  exit 1
fi

LEADER_CONTAINER=$(container_for_addr "${LEADER_ADDR}")
if [ -z "${LEADER_CONTAINER}" ]; then
  echo "  ✗ Unrecognised leader address: ${LEADER_ADDR}"
  exit 1
fi

echo "  Current leader: ${LEADER_ADDR}"
echo "  Container:      ${LEADER_CONTAINER}"

section "Step 2 — Stopping leader: ${LEADER_CONTAINER}"
podman stop "${LEADER_CONTAINER}"
echo "  ${LEADER_CONTAINER} stopped"

section "Step 3 — Watching for new leader election (checking every 2 s, up to 60 s)"
# Pick an alternative node to query
ALT_PORT="18200"
[ "${LEADER_CONTAINER}" = "arcanium-vault-1" ] && ALT_PORT="18202"

for i in $(seq 1 30); do
  sleep 2
  NEW_LEADER=$(VAULT_ADDR=https://127.0.0.1:${ALT_PORT} \
    vault operator raft list-peers -format=json 2>/dev/null |
    jq -r '.data.config.servers[] | select(.leader==true) | .address' 2>/dev/null || echo "")
  if [ -n "${NEW_LEADER}" ]; then
    echo "  ${i}×2 s → New leader elected: ${NEW_LEADER}"
    break
  else
    echo "  ${i}×2 s → election in progress..."
  fi
done

section "Step 4 — Restoring ${LEADER_CONTAINER}"
podman start "${LEADER_CONTAINER}"
echo "  ${LEADER_CONTAINER} started — waiting 20 s for Raft rejoin..."
sleep 20

section "Step 5 — Final cluster state"
make -C "${REPO_ROOT}" vault-status || true

echo ""
echo "  Demo complete. The original leader rejoins as a follower."
echo "  Grafana → Vault Cluster dashboard shows leader-change event."
