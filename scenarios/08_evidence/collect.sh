#!/usr/bin/env bash
# scenarios/08_evidence/collect.sh
# Runs all demo workloads for 5 minutes to collect meaningful evidence,
# then generates a maturity report.
#
# Usage:
#   ./scenarios/08_evidence/collect.sh           # 5-minute run (default)
#   EVIDENCE_WAIT=60 ./scenarios/08_evidence/collect.sh  # 60-second quick run

set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

ARCANIUM_API="${ARCANIUM_API:-http://localhost:3001}"
EVIDENCE_WAIT="${EVIDENCE_WAIT:-300}" # seconds

# ── helpers ──────────────────────────────────────────────────────────────────
section() {
  echo ""
  echo "══════════════════════════════════════════"
  echo "  $*"
  echo "══════════════════════════════════════════"
}

# ── main ─────────────────────────────────────────────────────────────────────
section "Arcanium Evidence Collection"
echo "  Waiting ${EVIDENCE_WAIT} s for workloads to accumulate evidence."
echo "  Arcanium API: ${ARCANIUM_API}"
echo ""

section "Step 1 — Ensure workloads are running"
make -C "${REPO_ROOT}" workloads-up 2>&1 | tail -5 || true

section "Step 2 — Evidence baseline"
BEFORE=$(curl -sf "${ARCANIUM_API}/api/v1/evidence" 2>/dev/null | jq 'length' 2>/dev/null || echo "?")
APPROVALS_BEFORE=$(curl -sf "${ARCANIUM_API}/api/v1/approvals" 2>/dev/null | jq 'length' 2>/dev/null || echo "?")
echo "  Evidence records:  ${BEFORE}"
echo "  Approval records:  ${APPROVALS_BEFORE}"

section "Step 3 — Collecting evidence (${EVIDENCE_WAIT} s)"
for i in $(seq "${EVIDENCE_WAIT}" -10 1); do
  printf "\r  Remaining: %4d s   " "${i}"
  sleep 10
done
echo ""

section "Step 4 — Evidence after collection"
AFTER=$(curl -sf "${ARCANIUM_API}/api/v1/evidence" 2>/dev/null | jq 'length' 2>/dev/null || echo "?")
APPROVALS_AFTER=$(curl -sf "${ARCANIUM_API}/api/v1/approvals" 2>/dev/null | jq 'length' 2>/dev/null || echo "?")
echo "  Evidence records:  ${AFTER}  (was ${BEFORE})"
echo "  Approval records:  ${APPROVALS_AFTER}  (was ${APPROVALS_BEFORE})"

section "Step 5 — Maturity report"
REPORT=$(curl -sf "${ARCANIUM_API}/api/v1/maturity" 2>/dev/null || echo '{}')
LEVEL=$(echo "${REPORT}" | jq -r '.level // "?"')
LEVEL_NAME=$(echo "${REPORT}" | jq -r '.levelName // "unknown"')
SCORE=$(echo "${REPORT}" | jq -r '.score // "?"')
MAX=$(echo "${REPORT}" | jq -r '.maxScore // "?"')
PCT=$(echo "${REPORT}" | jq -r '.percentage // "?"')

echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │  Arcanium Maturity Assessment            │"
echo "  │                                          │"
printf "  │  Level: %-2s %-30s│\n" "${LEVEL}" "${LEVEL_NAME}"
printf "  │  Score: %s / %s (%s%%)%-22s│\n" "${SCORE}" "${MAX}" "${PCT}" " "
echo "  └─────────────────────────────────────────┘"
echo ""

echo "  Checks:"
echo "${REPORT}" | jq -r '.checks[]? | "  \(if .passed then "✓" else "✗" end)  L\(.level)  \(.name)"' 2>/dev/null || true

echo ""
GAPS=$(echo "${REPORT}" | jq -r '.checks[]? | select(.passed == false) | "  → \(.recommendation)"' 2>/dev/null || true)
if [ -n "${GAPS}" ]; then
  echo "  Gaps to advance:"
  echo "${GAPS}"
else
  echo "  No gaps — maximum maturity achieved."
fi

echo ""
echo "  Full report (UI): http://localhost:3000/maturity"
echo "  Raw JSON:         ${ARCANIUM_API}/api/v1/maturity"
