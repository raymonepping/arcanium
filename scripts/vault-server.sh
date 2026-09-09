#!/bin/sh
set -eu
# Run as container root with all capabilities dropped so 0600 bind-mounted
# licenses/keys are readable under rootless Podman without loosening host modes.
if [ -f /run/secrets/transit-token ]; then
  VAULT_TOKEN=$(cat /run/secrets/transit-token)
  [ -n "$VAULT_TOKEN" ] || { echo 'Transit token is empty; run make vault-bootstrap.' >&2; exit 1; }
  export VAULT_TOKEN
fi
# Data and audit directories are supplied by named volumes. No external plugins
# are used, so the launcher must not create directories in the image filesystem.
mkdir -p /vault/file /vault/audit
exec vault server -config=/vault/config/config.hcl
