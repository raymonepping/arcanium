#!/usr/bin/env sh
# scripts/podman-drain.sh
#
# Force-remove arcanium containers in dependency order before compose down.
# Podman enforces volumes_from dependencies strictly — audit-rotators and agents
# must be removed before their parent vault nodes, otherwise compose down hits
# "has dependent containers" and creates ghost rename artifacts on the next up.
#
# Called automatically by `make down` and `make rehydrate`.
# Safe to run when the stack is already stopped — all errors are suppressed.

set -eu

# Pass 1: dependents first — anything that mounts from a vault node
podman ps -a --filter "name=arcanium" \
  --format "{{.ID}}\t{{.Names}}" 2>/dev/null |
  grep -E "rotator|agent|worker|ui|api|adminer|phpldap|otel|alloy|prom|grafana|loki|tempo|alert|swagger|localstack|step-ca|root-ca|certinfo|home|phpldapadmin|ldap-admin|payments|pki-client|kmip-client|docsign|external-supplier|keycloak|openldap" |
  awk '{print $1}' |
  xargs -r podman rm -f 2>/dev/null || true

# Pass 2: remaining arcanium containers (vault nodes, postgres, hsm, haproxy, etc.)
podman ps -a --filter "name=arcanium" \
  --format "{{.ID}}" 2>/dev/null |
  xargs -r podman rm -f 2>/dev/null || true
