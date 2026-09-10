#!/usr/bin/env bash
# scenarios/06_supplier_isolation/test_negative.sh
# Both directions of cross-namespace access must be denied (403).
set -euo pipefail
source .env.workloads

export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=$(pwd)/vault-tls/ca-chain.pem
PAYLOAD=$(echo -n "test-document" | base64)
ERRORS=0

_assert_403() {
  local label="$1" token="$2" namespace="$3" key="$4"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-Vault-Token: ${token}" \
    -H "X-Vault-Namespace: ${namespace}" \
    --cacert vault-tls/ca-chain.pem \
    -d "{\"input\":\"${PAYLOAD}\"}" \
    "https://127.0.0.1:18200/v1/transit/sign/${key}")
  [ "$status" = "403" ] &&
    echo "[negative-test] PASS — ${label}: 403" ||
    {
      echo "[negative-test] FAIL — ${label}: expected 403, got ${status}"
      ERRORS=$((ERRORS + 1))
    }
}

PEPSI_TOKEN=$(VAULT_NAMESPACE=suppliers/pepsi vault write -field=token auth/approle/login \
  role_id="${PEPSI_VAULT_ROLE_ID}" secret_id="${PEPSI_VAULT_SECRET_ID}")
COKE_TOKEN=$(VAULT_NAMESPACE=suppliers/cocacola vault write -field=token auth/approle/login \
  role_id="${COCACOLA_VAULT_ROLE_ID}" secret_id="${COCACOLA_VAULT_SECRET_ID}")

_assert_403 "pepsi → cocacola sign" "${PEPSI_TOKEN}" "suppliers/cocacola" "cocacola-signing-key"
_assert_403 "cocacola → pepsi sign" "${COKE_TOKEN}" "suppliers/pepsi" "pepsi-signing-key"

exit $ERRORS
