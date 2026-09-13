#!/bin/sh
# compose/arcanium/vault-agent/entrypoint.sh — Prompt 30, Deliverable 1.
#
# Vault Agent's AppRole auto-auth method needs role_id/secret_id as FILES,
# not env vars — but this project's existing credential-issuance path
# (scripts/workload-credentials.sh) writes them into .env as
# ARCANIUM_VAULT_ROLE_ID/ARCANIUM_VAULT_SECRET_ID, matching every other
# workload identity in this repo. This script is a translation shim only:
# it does not mint a new credential or claim ownership of this one (see
# docs/resource-ownership.md) — it just writes the SAME existing values to
# files so Agent can read them, then execs Agent itself.
#
# The secret_id value is never echoed or logged — only its presence/length
# would ever appear in a log line if this script printed diagnostics, and
# it deliberately does not.
set -eu

: "${ARCANIUM_VAULT_ROLE_ID:?ARCANIUM_VAULT_ROLE_ID is required}"
: "${ARCANIUM_VAULT_SECRET_ID:?ARCANIUM_VAULT_SECRET_ID is required}"

umask 077
printf '%s' "$ARCANIUM_VAULT_ROLE_ID" >/tmp/role-id
printf '%s' "$ARCANIUM_VAULT_SECRET_ID" >/tmp/secret-id
chmod 600 /tmp/role-id /tmp/secret-id

echo "[vault-agent entrypoint] role-id/secret-id files written, starting vault agent"
exec vault agent -config=/vault/agent/config.hcl
