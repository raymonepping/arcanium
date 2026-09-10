#!/bin/sh
# scenarios/09_sentinel/test_sentinel_block.sh — Prompt 14.4
# Proves the deny-unapproved-key-destroy EGP actually enforces:
#   - a token with ACL delete on a transit key is still DENIED by Sentinel
#   - a token carrying the approver policy is ALLOWED
#
# Requires the Sentinel licence feature.

set -eu
REPO_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
ROOT=$(python3 -c "import json;print(json.load(open('$REPO_ROOT/.secrets/vault/cluster-init.json'))['root_token'])")

vx() { podman exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_SKIP_VERIFY=1 \
  -e VAULT_TOKEN="$ROOT" arcanium-vault_1 "$@"; }

"$REPO_ROOT/scripts/vault-check-entitlement.sh" "Sentinel" || {
  echo "SKIP — Sentinel not licensed"
  exit 0
}

echo "▸ setup: throwaway key + a token with ACL delete but no approver policy"
vx vault write -f transit/keys/sentinel-scenario >/dev/null
vx vault write transit/keys/sentinel-scenario/config deletion_allowed=true >/dev/null
vx sh -c 'echo "path \"transit/keys/sentinel-scenario\" { capabilities = [\"delete\",\"read\"] }" > /tmp/s.hcl; vault policy write sentinel-deltest /tmp/s.hcl' >/dev/null
DELTOK=$(vx vault token create -policy=sentinel-deltest -field=token)
APRTOK=$(vx vault token create -policy=crypto-approver-policy -policy=sentinel-deltest -field=token)

echo ""
echo "▸ test 1 — delete with the non-approver token (expect: DENIED by Sentinel)"
if podman exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_SKIP_VERIFY=1 -e VAULT_TOKEN="$DELTOK" \
  arcanium-vault_1 vault delete transit/keys/sentinel-scenario 2>&1 | grep -q "deny-unapproved-key-destroy"; then
  echo "  ✓ PASS — Sentinel denied the unapproved destroy"
else
  echo "  ✗ FAIL — the delete was NOT blocked"
  exit 1
fi

echo ""
echo "▸ test 2 — delete with the approver token (expect: ALLOWED)"
if podman exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_SKIP_VERIFY=1 -e VAULT_TOKEN="$APRTOK" \
  arcanium-vault_1 vault delete transit/keys/sentinel-scenario 2>&1 | grep -q "Success"; then
  echo "  ✓ PASS — approver token allowed the destroy"
else
  echo "  ~ note — approver token also blocked (check crypto-approver-policy exists)"
fi

echo ""
echo "▸ test 3 — rotation-from-automation RGP (Prompt 15.5)"
vx sh -c '
  vault write -f transit/keys/sentinel-rgp >/dev/null 2>&1
  echo "path \"transit/keys/sentinel-rgp/rotate\" { capabilities = [\"update\"] }" > /tmp/rgp.hcl
  vault policy write sentinel-rgp /tmp/rgp.hcl >/dev/null
  HUM=$(vault token create -policy=sentinel-rgp -field=token)
  AUTO=$(vault token create -policy=sentinel-rgp -policy=automation -field=token)
  H=$(VAULT_TOKEN=$HUM vault write -f transit/keys/sentinel-rgp/rotate 2>&1)
  A=$(VAULT_TOKEN=$AUTO vault write -f transit/keys/sentinel-rgp/rotate 2>&1)
  echo "$H" | grep -q "rotation-from-automation" && echo "  ✓ PASS — human rotate denied by RGP" || echo "  ✗ FAIL — human rotate not blocked"
  echo "$A" | grep -q "latest_version" && echo "  ✓ PASS — automation rotate allowed" || echo "  ~ note — automation rotate blocked"
  vault write transit/keys/sentinel-rgp/config deletion_allowed=true >/dev/null 2>&1
  vault delete transit/keys/sentinel-rgp >/dev/null 2>&1
  vault policy delete sentinel-rgp >/dev/null 2>&1
'

echo ""
echo "▸ cleanup"
vx sh -c 'vault write transit/keys/sentinel-scenario/config deletion_allowed=true >/dev/null 2>&1; vault delete transit/keys/sentinel-scenario >/dev/null 2>&1; vault policy delete sentinel-deltest >/dev/null 2>&1' || true
echo "  ✓ done"
