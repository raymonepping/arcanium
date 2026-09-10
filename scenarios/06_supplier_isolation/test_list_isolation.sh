#!/usr/bin/env bash
# scenarios/06_supplier_isolation/test_list_isolation.sh
# Pepsi must not be able to LIST or discover Cocacola's Transit key metadata.
set -euo pipefail
source .env.workloads

export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=$(pwd)/vault-tls/ca-chain.pem
ERRORS=0

PEPSI_TOKEN=$(VAULT_NAMESPACE=suppliers/pepsi vault write -field=token auth/approle/login \
  role_id="${PEPSI_VAULT_ROLE_ID}" secret_id="${PEPSI_VAULT_SECRET_ID}")

# Pepsi tries to LIST cocacola's Transit keys — must be 403
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Vault-Token: ${PEPSI_TOKEN}" \
  -H "X-Vault-Namespace: suppliers/cocacola" \
  -X LIST \
  --cacert vault-tls/ca-chain.pem \
  "https://127.0.0.1:18200/v1/transit/keys")
[ "$STATUS" = "403" ] &&
  echo "[list-isolation] PASS — pepsi LIST cocacola transit/keys: 403" ||
  {
    echo "[list-isolation] FAIL — expected 403, got ${STATUS}"
    ERRORS=$((ERRORS + 1))
  }

# Cocacola tries to LIST pepsi's Transit keys — must be 403
COKE_TOKEN=$(VAULT_NAMESPACE=suppliers/cocacola vault write -field=token auth/approle/login \
  role_id="${COCACOLA_VAULT_ROLE_ID}" secret_id="${COCACOLA_VAULT_SECRET_ID}")

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Vault-Token: ${COKE_TOKEN}" \
  -H "X-Vault-Namespace: suppliers/pepsi" \
  -X LIST \
  --cacert vault-tls/ca-chain.pem \
  "https://127.0.0.1:18200/v1/transit/keys")
[ "$STATUS" = "403" ] &&
  echo "[list-isolation] PASS — cocacola LIST pepsi transit/keys: 403" ||
  {
    echo "[list-isolation] FAIL — expected 403, got ${STATUS}"
    ERRORS=$((ERRORS + 1))
  }

exit $ERRORS
