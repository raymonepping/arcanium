#!/usr/bin/env bash
# scenarios/03_kmip/provision.sh
# mTLS certificate provisioning / renewal for the kmip-client workload.
#
#   provision.sh            issue a client cert (first-time provisioning)
#   provision.sh --renew    re-issue only if the current cert expires within
#                           KMIP_RENEW_BEFORE_SECONDS (default 48h) or is gone,
#                           then revoke the old serial in Vault
#
# The KMIP role caps client certs at 7 days (terraform/vault-kmip:
# default_tls_client_ttl), so a one-time cert WILL expire. On 2026-09-22 it
# did, and arcanium-kmip-client restart-looped for two weeks — Vault resets
# the connection at the first KMIP request. Run `make kmip-renew` at least
# weekly (it is safe to run any time).
set -euo pipefail

RENEW=false
[ "${1:-}" = "--renew" ] && RENEW=true
: "${KMIP_RENEW_BEFORE_SECONDS:=172800}" # 48h

DIR=.secrets/kmip
mkdir -p "$DIR"

export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=$(pwd)/vault-tls/ca-chain.pem
export VAULT_TOKEN=$(jq -r .root_token .secrets/vault/cluster-init.json)

ROLE_PATH=kmip/scope/arcanium/role/legacy-db
OLD_SERIAL=""

if [ -f "$DIR/client.pem" ]; then
  if $RENEW && openssl x509 -in "$DIR/client.pem" -noout -checkend "$KMIP_RENEW_BEFORE_SECONDS" >/dev/null 2>&1; then
    echo "[kmip-provision] client certificate valid beyond the renewal window ($(openssl x509 -in "$DIR/client.pem" -noout -enddate | cut -d= -f2)) — nothing to do"
    exit 0
  fi
  # Vault identifies KMIP credentials by colon-separated lowercase hex serial
  OLD_SERIAL=$(openssl x509 -in "$DIR/client.pem" -noout -serial | cut -d= -f2 |
    tr '[:upper:]' '[:lower:]' | sed 's/../&:/g; s/:$//')
fi

echo "[kmip-provision] generating mTLS client certificate for legacy-db role..."

vault write -format=json \
  "$ROLE_PATH/credential/generate" \
  format=pem >"$DIR/legacy-db-creds.json.tmp"

# Write all files from the new response, then swap atomically so the running
# client (which watches this bind mount) never sees a cert/key mismatch.
jq -r '.data.certificate' "$DIR/legacy-db-creds.json.tmp" >"$DIR/client.pem.tmp"
jq -r '.data.private_key' "$DIR/legacy-db-creds.json.tmp" >"$DIR/client.key.tmp"
# Write the full CA chain (all entries joined) so TLS verification succeeds
jq -r '.data.ca_chain[]' "$DIR/legacy-db-creds.json.tmp" >"$DIR/ca.pem.tmp"
chmod 600 "$DIR/client.key.tmp" "$DIR/legacy-db-creds.json.tmp"
for f in client.key client.pem ca.pem legacy-db-creds.json; do mv "$DIR/$f.tmp" "$DIR/$f"; done

echo "[kmip-provision] client certificate written to $DIR/ (expires $(openssl x509 -in "$DIR/client.pem" -noout -enddate | cut -d= -f2))"

if [ -n "$OLD_SERIAL" ]; then
  if vault write "$ROLE_PATH/credential/revoke" serial_number="$OLD_SERIAL" >/dev/null 2>&1; then
    echo "[kmip-provision] revoked previous credential $OLD_SERIAL"
  else
    echo "[kmip-provision] previous credential $OLD_SERIAL not revoked (already expired or gone) — fine"
  fi
fi

$RENEW || echo "[kmip-provision] run: make workloads-up"
