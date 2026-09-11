#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <vault|infra|hsm|arcanium|observability|workloads|kms-sim|identity> <compose arguments...>" >&2
  exit 64
fi

stack=$1
shift

case "$stack" in
vault | infra | hsm | arcanium | observability | workloads | kms-sim | identity) ;;
*)
  echo "Unknown stack: $stack" >&2
  exit 64
  ;;
esac

project_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
compose_file="$project_root/compose/$stack/compose.yaml"

if [ ! -f "$compose_file" ]; then
  echo "Stack '$stack' is not implemented yet: $compose_file is missing." >&2
  exit 66
fi

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required but was not found in PATH." >&2
  exit 69
fi

# Pin the native provider when it is installed. Callers can override this for
# compatibility testing without changing the canonical project workflow.
: "${PODMAN_COMPOSE_PROVIDER:=podman-compose}"
export PODMAN_COMPOSE_PROVIDER

exec podman compose \
  --project-name "arcanium-$stack" \
  --file "$compose_file" \
  --env-file "$project_root/.env" \
  "$@"
