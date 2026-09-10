#!/usr/bin/env bash
# scenarios/06_supplier_isolation/test_positive.sh
# Both suppliers sign with their own key — both must succeed.
set -euo pipefail
source .env.workloads

export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=$(pwd)/vault-tls/ca-chain.pem
PAYLOAD=$(echo -n "test-document" | base64)
ERRORS=0

# --- pepsi → pepsi ---
PEPSI_TOKEN=$(VAULT_NAMESPACE=suppliers/pepsi vault write -field=token auth/approle/login \
  role_id="${PEPSI_VAULT_ROLE_ID}" secret_id="${PEPSI_VAULT_SECRET_ID}")
RESULT=$(VAULT_NAMESPACE=suppliers/pepsi VAULT_TOKEN="${PEPSI_TOKEN}" \
  vault write -format=json transit/sign/pepsi-signing-key input="${PAYLOAD}")
SIG=$(echo "$RESULT" | jq -r '.data.signature')
VALID=$(VAULT_NAMESPACE=suppliers/pepsi VAULT_TOKEN="${PEPSI_TOKEN}" \
  vault write -format=json transit/verify/pepsi-signing-key \
  input="${PAYLOAD}" signature="${SIG}" | jq -r '.data.valid')
[ "$VALID" = "true" ] &&
  echo "[positive-test] PASS — pepsi → pepsi: valid=true" ||
  {
    echo "[positive-test] FAIL — pepsi → pepsi: got valid=$VALID"
    ERRORS=$((ERRORS + 1))
  }

# --- cocacola → cocacola ---
COKE_TOKEN=$(VAULT_NAMESPACE=suppliers/cocacola vault write -field=token auth/approle/login \
  role_id="${COCACOLA_VAULT_ROLE_ID}" secret_id="${COCACOLA_VAULT_SECRET_ID}")
RESULT=$(VAULT_NAMESPACE=suppliers/cocacola VAULT_TOKEN="${COKE_TOKEN}" \
  vault write -format=json transit/sign/cocacola-signing-key input="${PAYLOAD}")
SIG=$(echo "$RESULT" | jq -r '.data.signature')
VALID=$(VAULT_NAMESPACE=suppliers/cocacola VAULT_TOKEN="${COKE_TOKEN}" \
  vault write -format=json transit/verify/cocacola-signing-key \
  input="${PAYLOAD}" signature="${SIG}" | jq -r '.data.valid')
[ "$VALID" = "true" ] &&
  echo "[positive-test] PASS — cocacola → cocacola: valid=true" ||
  {
    echo "[positive-test] FAIL — cocacola → cocacola: got valid=$VALID"
    ERRORS=$((ERRORS + 1))
  }

exit $ERRORS
