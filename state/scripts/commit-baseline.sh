#!/usr/bin/env bash
# commit-baseline.sh — tag + commit + push one captured baseline, using
# commit_gh where it fits (secret scan, rebase-pull, commit, push).
#
# What this does NOT do: stage or commit anything outside state/. commit_gh
# runs `git add .` (whole working tree, no path scoping), so this script
# refuses to run if anything other than state/ is dirty — a baseline commit
# must not silently absorb unrelated in-progress work.
#
# Usage:
#   state/scripts/commit-baseline.sh <baseline-id> [tag-name] [commit-message]
#
# Examples:
#   state/scripts/commit-baseline.sh 2026-09-11_pre-hardening
#   state/scripts/commit-baseline.sh 2026-09-11_pre-hardening arcanium-pre-hardening \
#     "Arcanium baseline before Prompt 18 Security Foundation"
#
# If the named tag already exists, tagging is skipped (not an error) — this
# is meant to be safe to re-run, e.g. if a manual `git tag` already happened.
set -uo pipefail
cd "$(dirname -- "$0")/../.." # -> repo root

BASELINE_ID="${1:?usage: commit-baseline.sh <baseline-id> [tag-name] [commit-message]}"
BASE="state/baselines/${BASELINE_ID}"
TAG="${2:-arcanium-${BASELINE_ID//_/-}}"
MESSAGE="${3:-Arcanium baseline: ${BASELINE_ID}}"

if [ ! -d "$BASE" ]; then
  echo "error: no such baseline: $BASE" >&2
  exit 2
fi

echo "== commit-baseline =="
echo "  baseline: $BASE"
echo "  tag:      $TAG"
echo "  message:  $MESSAGE"
echo

# --- 1. secret validation (hard gate) ------------------------------------
echo "-> validating baseline for secrets"
if ! state/scripts/validate-state.sh "$BASELINE_ID"; then
  echo "ABORT: validate-state.sh found something secret-shaped in $BASE." >&2
  echo "Fix it before committing — do not override this check." >&2
  exit 1
fi
echo

# --- 2. known stray file cleanup -----------------------------------------
# state/README.md documents that only capture-state.sh writes under state/;
# a FOLDER_TREE.md dropped here (e.g. from running commit_gh --tree from
# inside state/) violates that and doesn't belong in this directory.
if [ -f state/FOLDER_TREE.md ]; then
  echo "-> removing state/FOLDER_TREE.md (not written by capture-state.sh; see state/README.md)"
  rm -f state/FOLDER_TREE.md
fi
echo

# --- 3. refuse to bundle unrelated changes --------------------------------
echo "-> checking nothing outside state/ is dirty (commit_gh stages the whole tree)"
OUTSIDE="$(git status --porcelain | awk '{print $2}' | grep -v '^state/' || true)"
if [ -n "$OUTSIDE" ]; then
  echo "ABORT: changes exist outside state/ — commit or stash them separately first:" >&2
  echo "$OUTSIDE" | sed 's/^/  /' >&2
  exit 1
fi
echo "  clean — only state/ is pending"
echo

# --- 4. tag (skip if it already exists) -----------------------------------
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "-> tag $TAG already exists (points at $(git rev-parse --short "$TAG")) — not recreating"
else
  echo "-> creating annotated tag $TAG"
  git tag -a "$TAG" -m "$MESSAGE" || {
    echo "ABORT: git tag failed" >&2
    exit 1
  }
fi
echo

# --- 5. commit + push via commit_gh ---------------------------------------
if ! command -v commit_gh >/dev/null 2>&1; then
  echo "commit_gh not found on PATH — falling back to plain git." >&2
  git add state/
  git commit -m "$MESSAGE"
else
  echo "-> commit_gh --message \"$MESSAGE\" --tree false"
  echo "   (stages, gitleaks-scans staged files, rebases onto origin/main, commits, pushes)"
  commit_gh --message "$MESSAGE" --tree false
fi
echo

# --- 6. push the tag (commit_gh's plain commit flow does not push tags) --
echo "-> pushing tag $TAG"
if git push origin "refs/tags/$TAG"; then
  echo "  tag pushed"
else
  echo "  tag push failed or was already up to date — check above output" >&2
fi

echo
echo "Done. Commit: $(git rev-parse --short HEAD)  Tag: $TAG -> $(git rev-parse --short "$TAG")"
