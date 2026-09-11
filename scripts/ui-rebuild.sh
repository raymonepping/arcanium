#!/bin/sh
# Rebuild from a streamed source archive to avoid stale VM-mounted source files.
set -eu
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)
UI_DIR="$PROJECT_ROOT/arcanium/ui"
TAIL_LOGS=0
for arg in "$@"; do
  case "$arg" in
  --logs | -l) TAIL_LOGS=1 ;;
  --help | -h)
    echo "Usage: $0 [--logs]"
    exit 0
    ;;
  *)
    echo "Unknown option: $arg" >&2
    exit 64
    ;;
  esac
done
ARCHIVE=$(mktemp /tmp/arcanium-ui-build.XXXXXX)
trap 'rm -f "$ARCHIVE"' EXIT HUP INT TERM
tar -C "$UI_DIR" --exclude=node_modules --exclude=.nuxt --exclude=.output --exclude=test-results --exclude=playwright-report --exclude=.env -czf "$ARCHIVE" .
echo 'Building arcanium-ui:local…'
podman build --format docker --platform "linux/$(uname -m | sed 's/x86_64/amd64/')" -t arcanium-ui:local -f Containerfile - <"$ARCHIVE"
echo 'Recreating arcanium-ui…'
"$SCRIPT_DIR/compose.sh" arcanium up -d --no-deps --force-recreate arcanium-ui
WAIT=0
while [ "$WAIT" -lt 60 ]; do
  STATUS=$(podman inspect arcanium-ui --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  if [ "$STATUS" = healthy ]; then
    echo 'arcanium-ui is healthy: http://localhost:3000/'
    if [ "$TAIL_LOGS" -eq 1 ]; then podman logs -f arcanium-ui; fi
    exit 0
  fi
  sleep 2
  WAIT=$((WAIT + 2))
done
echo 'UI did not become healthy. Inspect: podman logs arcanium-ui' >&2
exit 1
