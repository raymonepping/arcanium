#!/usr/bin/env bash
# scenarios/03_kmip/provision.sh
# One-time mTLS certificate provisioning for the kmip-client workload.
set -euo pipefail

mkdir -p .secrets/kmip

export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=$(pwd)/vault-tls/ca-chain.pem
export VAULT_TOKEN=$(jq -r .root_token .secrets/vault/cluster-init.json)

echo "[kmip-provision] generating mTLS client certificate for legacy-db role..."

vault write -format=json \
  kmip/scope/arcanium/role/legacy-db/credential/generate \
  format=pem >.secrets/kmip/legacy-db-creds.json

jq -r '.data.certificate' .secrets/kmip/legacy-db-creds.json >.secrets/kmip/client.pem
jq -r '.data.private_key' .secrets/kmip/legacy-db-creds.json >.secrets/kmip/client.key
# Write the full CA chain (all entries joined) so TLS verification succeeds
jq -r '.data.ca_chain[]' .secrets/kmip/legacy-db-creds.json >.secrets/kmip/ca.pem

chmod 600 .secrets/kmip/client.key

echo "[kmip-provision] client certificate written to .secrets/kmip/"
echo "[kmip-provision] run: make workloads-up"
