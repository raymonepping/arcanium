#!/usr/bin/env bash
# scenarios/06_supplier_isolation/provision.sh
# Register suppliers in Arcanium API and generate AppRole credentials in each namespace.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=$(pwd)/vault-tls/ca-chain.pem
export VAULT_TOKEN=$(jq -er '.root_token' .secrets/vault/cluster-init.json)

ARCANIUM_API="${ARCANIUM_API:-http://localhost:3001}"

# ── Authenticate if the stack requires it ─────────────────────────────────
# Same predates-auth gap as scenarios/01_onboarding/run.sh: this script's
# plain unauthenticated POSTs to /api/v1/suppliers 401 once
# ARCANIUM_AUTH_ENABLED=true. Prompt 29 — extracted into scenarios/lib/
# oidc_login.sh after this exact block was independently re-patched into
# two other scenario scripts the same day.
source "$REPO_ROOT/scenarios/lib/oidc_login.sh"
OIDC_LOGIN_TAG="isolation"
CURL_AUTH=()
if [ "$(auth_enabled "$ARCANIUM_API")" = "true" ]; then
  echo "[isolation] ARCANIUM_AUTH_ENABLED — signing in as demo-architect"
  oidc_login "demo-architect" "Arcanium-arch-2026" "$ARCANIUM_API" || exit 1
  trap 'rm -f "$OIDC_JAR"' EXIT
  CURL_AUTH=(-b "$OIDC_JAR")
fi

echo "[isolation] registering suppliers in Arcanium API..."

register_supplier() {
  local name="$1" namespace="$2"
  # Idempotency: a prior successful run (data survives a stack restart,
  # since it lives in Postgres) leaves this supplier already registered —
  # found live as a real 409 "supplier name or namespace already exists"
  # from a plain re-POST. Check first, same pattern as
  # scenarios/01_onboarding/run.sh's register_app().
  local existing
  existing=$(curl -sf "${CURL_AUTH[@]}" "${ARCANIUM_API}/api/v1/suppliers" |
    jq -r --arg n "$name" '.[] | select(.name==$n) | .id' 2>/dev/null || true)
  if [ -n "$existing" ]; then
    echo "[isolation] '$name' already registered: $existing" >&2
    echo "$existing"
    return
  fi
  local id
  id=$(curl -sf "${CURL_AUTH[@]}" -X POST "${ARCANIUM_API}/api/v1/suppliers" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${name}\",\"vault_namespace\":\"${namespace}\",\"sla_tier\":\"standard\"}" | jq -r .id)
  echo "[isolation] registered '${name}': ${id}" >&2
  echo "$id"
}

PEPSI_ID=$(register_supplier "pepsi" "suppliers/pepsi")
COCACOLA_ID=$(register_supplier "cocacola" "suppliers/cocacola")

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
