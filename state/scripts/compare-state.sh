#!/usr/bin/env bash
# compare-state.sh — diff two baselines' manifest.yaml and summary.md.
#
# Usage:
#   state/scripts/compare-state.sh <baseline-a> <baseline-b>
#   state/scripts/compare-state.sh 2026-09-11_pre-hardening 2026-09-20_post-18-security
#
# With one argument, compares that baseline against whatever state/CURRENT
# pointed to before it (i.e. the previous baseline) — convenient right after
# a new capture.
set -uo pipefail
cd "$(dirname -- "$0")/../.." # -> repo root

resolve() {
  local a="$1"
  [ -d "$a" ] && {
    echo "$a"
    return
  }
  [ -d "state/baselines/$a" ] && {
    echo "state/baselines/$a"
    return
  }
  echo "error: no such baseline: $a" >&2
  exit 2
}

if [ $# -eq 2 ]; then
  A="$(resolve "$1")"
  B="$(resolve "$2")"
elif [ $# -eq 1 ]; then
  B="$(resolve "$1")"
  # Find the baseline captured immediately before B by directory mtime.
  A="$(ls -dt state/baselines/*/ 2>/dev/null | grep -v "^${B}/\$" | head -1 | sed 's:/$::')"
  [ -z "$A" ] && {
    echo "error: no earlier baseline found to compare against" >&2
    exit 2
  }
else
  echo "usage: compare-state.sh <baseline-a> [<baseline-b>]" >&2
  exit 2
fi

echo "Comparing:"
echo "  A: $A"
echo "  B: $B"
echo

echo "## manifest.yaml diff"
diff -u "$A/manifest.yaml" "$B/manifest.yaml" || true
echo

echo "## scenario verification diff"
diff -u "$A/scenarios/results.json" "$B/scenarios/results.json" 2>/dev/null || true
echo

echo "## capabilities diff (arcanium mode flags)"
diff -u "$A/arcanium/capabilities.json" "$B/arcanium/capabilities.json" 2>/dev/null || true
