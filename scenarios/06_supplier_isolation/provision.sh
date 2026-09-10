#!/usr/bin/env bash
# scenarios/06_supplier_isolation/provision.sh
# Register suppliers in Arcanium API and generate AppRole credentials in each namespace.
set -euo pipefail

export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=$(pwd)/vault-tls/ca-chain.pem
export VAULT_TOKEN=$(jq -r .root_token .secrets/vault/cluster-init.json)

echo "[isolation] registering suppliers in Arcanium API..."

PEPSI_ID=$(curl -sf -X POST http://localhost:3001/api/v1/suppliers \
  -H "Content-Type: application/json" \
  -d '{"name":"pepsi","vault_namespace":"suppliers/pepsi","sla_tier":"standard"}' |
  jq -r .id)
echo "[isolation] registered pepsi: $PEPSI_ID"

COCACOLA_ID=$(curl -sf -X POST http://localhost:3001/api/v1/suppliers \
  -H "Content-Type: application/json" \
  -d '{"name":"cocacola","vault_namespace":"suppliers/cocacola","sla_tier":"standard"}' |
  jq -r .id)
echo "[isolation] registered cocacola: $COCACOLA_ID"

echo "[isolation] generating AppRole credentials in each namespace..."

PEPSI_ROLE_ID=$(VAULT_NAMESPACE=suppliers/pepsi vault read -field=role_id \
  auth/approle/role/pepsi-app-role/role-id)
PEPSI_SECRET_ID=$(VAULT_NAMESPACE=suppliers/pepsi vault write -f -field=secret_id \
  auth/approle/role/pepsi-app-role/secret-id)

PEPSI_APPROVER_ROLE_ID=$(VAULT_NAMESPACE=suppliers/pepsi vault read -field=role_id \
  auth/approle/role/pepsi-approver-role/role-id)
PEPSI_APPROVER_SECRET_ID=$(VAULT_NAMESPACE=suppliers/pepsi vault write -f -field=secret_id \
  auth/approle/role/pepsi-approver-role/secret-id)

COCACOLA_ROLE_ID=$(VAULT_NAMESPACE=suppliers/cocacola vault read -field=role_id \
  auth/approle/role/cocacola-app-role/role-id)
COCACOLA_SECRET_ID=$(VAULT_NAMESPACE=suppliers/cocacola vault write -f -field=secret_id \
  auth/approle/role/cocacola-app-role/secret-id)

COCACOLA_APPROVER_ROLE_ID=$(VAULT_NAMESPACE=suppliers/cocacola vault read -field=role_id \
  auth/approle/role/cocacola-approver-role/role-id)
COCACOLA_APPROVER_SECRET_ID=$(VAULT_NAMESPACE=suppliers/cocacola vault write -f -field=secret_id \
  auth/approle/role/cocacola-approver-role/secret-id)

cat >>.env.workloads <<EOF
PEPSI_VAULT_ROLE_ID=${PEPSI_ROLE_ID}
PEPSI_VAULT_SECRET_ID=${PEPSI_SECRET_ID}
PEPSI_APPROVER_VAULT_ROLE_ID=${PEPSI_APPROVER_ROLE_ID}
PEPSI_APPROVER_VAULT_SECRET_ID=${PEPSI_APPROVER_SECRET_ID}
PEPSI_SUPPLIER_ID=${PEPSI_ID}
COCACOLA_VAULT_ROLE_ID=${COCACOLA_ROLE_ID}
COCACOLA_VAULT_SECRET_ID=${COCACOLA_SECRET_ID}
COCACOLA_APPROVER_VAULT_ROLE_ID=${COCACOLA_APPROVER_ROLE_ID}
COCACOLA_APPROVER_VAULT_SECRET_ID=${COCACOLA_APPROVER_SECRET_ID}
COCACOLA_SUPPLIER_ID=${COCACOLA_ID}
EOF
echo "[isolation] credentials written to .env.workloads"
