#!/usr/bin/env bash
# scenarios/10_key_distribution/run.sh — Prompt 15.5
#
# Demonstrates the Key Management secrets engine distribution lifecycle
# (distribute → rotate → the copy follows → target goes unreachable) against an
# EMULATED KMS (LocalStack, compose/kms-sim). No cloud account, nothing leaves
# the machine. The distribution is never presented as a real cloud KMS.
#
# Prereqs: Vault cluster up, "Key Management Secrets Engine" licensed.

set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO_ROOT"

ROOT=$(python3 -c "import json;print(json.load(open('.secrets/vault/cluster-init.json'))['root_token'])")
vx() { podman exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_SKIP_VERIFY=1 \
  -e VAULT_TOKEN="$ROOT" arcanium-vault_1 "$@"; }
KMS_URL="http://localhost:4566"
kms_list_keys() {
  curl -s -X POST "$KMS_URL/" \
    -H 'X-Amz-Target: TrentService.ListKeys' \
    -H 'Content-Type: application/x-amz-json-1.1' \
    -H 'Authorization: AWS4-HMAC-SHA256 Credential=test/x/us-east-1/kms/aws4_request' \
    -d '{}'
}

./scripts/vault-check-entitlement.sh "Key Management Secrets Engine" || {
  echo "SKIP — Key Management Secrets Engine not licensed"
  exit 0
}

echo "▸ 1. bring up the emulated KMS (LocalStack, kms service only)"
make --no-print-directory kms-sim-up
for i in $(seq 1 24); do
  hs=$(podman inspect arcanium-localstack --format '{{.State.Health.Status}}' 2>/dev/null || true)
  [ "$hs" = "healthy" ] && break
  sleep 5
done
echo "  localstack: $(podman inspect arcanium-localstack --format '{{.State.Health.Status}}')"

echo ""
echo "▸ 2. clean slate — the emulated KMS does not persist across container restarts,"
echo "     so reset the engine to keep the demo reproducible"
vx vault secrets disable keymgmt >/dev/null 2>&1 || true
vx vault secrets enable keymgmt >/dev/null 2>&1 || true
vx vault write keymgmt/key/arcanium-distributed type=aes256-gcm96 deletion_allowed=true >/dev/null
vx vault write keymgmt/kms/localstack \
  provider=awskms key_collection=us-east-1 \
  credentials=access_key=test credentials=secret_key=test \
  credentials=endpoint=http://arcanium-localstack:4566 >/dev/null
vx vault write keymgmt/kms/localstack/key/arcanium-distributed \
  purpose=encrypt,decrypt protection=hsm >/dev/null
vx vault read keymgmt/kms/localstack/key/arcanium-distributed

echo ""
echo "▸ 3. the copy exists in the emulated KMS"
kms_list_keys | python3 -m json.tool

echo ""
echo "▸ 4. rotate the Vault-owned key — the engine follows to the emulated KMS"
vx vault write -f keymgmt/key/arcanium-distributed/rotate
sleep 2
echo "  vault key versions:"
vx vault read -field=versions keymgmt/key/arcanium-distributed
echo "  emulated KMS keys after rotation:"
kms_list_keys | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["Keys"]),"key(s) in the emulated KMS")'

echo ""
echo "▸ 5. stop the emulated KMS — the distribution status must go 'unreachable', not fake-OK"
make --no-print-directory kms-sim-down
sleep 5
curl -s --max-time 30 "http://localhost:3001/api/v1/keymgmt" | python3 - <<'PY' || echo "  (could not parse — inspect GET /api/v1/keymgmt manually)"
import sys, json
d = json.load(sys.stdin)
for k in d.get("keys", []):
    targets = k.get("distributed_to", [])
    if not targets:
        print(f"  {k['name']}: no targets listed")
    for t in targets:
        print(f"  {k['name']} -> {t['name']}: {t['status']}  (reachable={t['reachable']})")
PY

echo ""
echo "▸ 6. bring the emulated KMS back and re-establish a clean distribution"
make --no-print-directory kms-sim-up
for i in $(seq 1 24); do
  hs=$(podman inspect arcanium-localstack --format '{{.State.Health.Status}}' 2>/dev/null || true)
  [ "$hs" = "healthy" ] && break
  sleep 5
done
vx vault secrets disable keymgmt >/dev/null 2>&1 || true
vx vault secrets enable keymgmt >/dev/null 2>&1 || true
vx vault write keymgmt/key/arcanium-distributed type=aes256-gcm96 deletion_allowed=true >/dev/null
vx vault write keymgmt/kms/localstack \
  provider=awskms key_collection=us-east-1 \
  credentials=access_key=test credentials=secret_key=test \
  credentials=endpoint=http://arcanium-localstack:4566 >/dev/null
vx vault write keymgmt/kms/localstack/key/arcanium-distributed \
  purpose=encrypt,decrypt protection=hsm >/dev/null
echo "  clean state restored"

echo ""
echo "▸ done — distribute → rotate → follow → unreachable, all against an emulated KMS."
echo "  A real cloud KMS is the same config with the endpoint override removed."
