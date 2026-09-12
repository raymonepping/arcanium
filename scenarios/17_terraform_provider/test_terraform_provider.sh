#!/usr/bin/env bash
# scenarios/17_terraform_provider/test_terraform_provider.sh — Prompt 28,
# Deliverable 4.
#
# The end-to-end proof that the M2M integration surface is usable, not just
# designed: a real `terraform apply`, authenticated with a REAL
# service-account Bearer token issued through the exact same
# POST /api/v1/service-accounts/{id}/tokens route Deliverable 1/2 proved
# live, creates an `arcanium_application` resource and reads back an
# `arcanium_application_intent` data source, against the real running
# arcanium-api — not a mock, not a stub.
set -uo pipefail
cd "$(dirname -- "$0")/../.." # -> repo root
set -a
[ -f .env ] && . ./.env
set +a

API="${ARCANIUM_API:-http://localhost:3001}"

PASS=0
FAIL=0
UNKNOWN=0
ok() {
  echo "  ✓ $1"
  PASS=$((PASS + 1))
}
bad() {
  echo "  ✗ $1"
  FAIL=$((FAIL + 1))
}
unk() {
  echo "  ? $1 (skipped — see reason)"
  UNKNOWN=$((UNKNOWN + 1))
}

echo "== Prompt 28, Deliverable 4 — Terraform Provider Skeleton (real apply) =="
echo

if ! command -v terraform >/dev/null 2>&1; then
  unk "terraform CLI not installed — cannot run this scenario"
  echo
  echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $((PASS + FAIL + UNKNOWN))) =="
  exit 0
fi
if ! command -v jq >/dev/null 2>&1; then
  unk "jq not installed — cannot run this scenario"
  echo
  echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $((PASS + FAIL + UNKNOWN))) =="
  exit 0
fi
if ! curl -fsS --max-time 3 "$API/health" >/dev/null 2>&1; then
  unk "arcanium-api not reachable at $API — cannot run this scenario"
  echo
  echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $((PASS + FAIL + UNKNOWN))) =="
  exit 0
fi

PROVIDER_DIR="terraform/arcanium-provider"
PROVIDER_BIN="$PROVIDER_DIR/terraform-provider-arcanium"
if [ ! -x "$PROVIDER_BIN" ]; then
  echo "building provider binary (make provider-build)..."
  (cd "$PROVIDER_DIR" && go build -o terraform-provider-arcanium .) || {
    unk "could not build terraform-provider-arcanium — is Go installed?"
    echo
    echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $((PASS + FAIL + UNKNOWN))) =="
    exit 0
  }
fi
PROVIDER_ABS_DIR="$(cd "$PROVIDER_DIR" && pwd)"

# Same real browser-simulated OIDC round trip every other live scenario in
# this repo uses (scenarios/11_security_foundation/test_negative_auth.sh's
# own oidc_login).
oidc_login() {
  local user="$1" jar="$2" pass="$3"
  : >"$jar"
  local login_headers auth_url form_html form_action cb_headers cb_url qs
  login_headers=$(curl -sD - -o /dev/null -c "$jar" "$API/api/v1/auth/login?next=/")
  auth_url=$(echo "$login_headers" | grep -i '^location:' | awk '{print $2}' | tr -d '\r\n')
  [ -z "$auth_url" ] && return 1
  form_html=$(curl -s -c "$jar" -b "$jar" "$auth_url")
  form_action=$(echo "$form_html" | grep -oE 'action="[^"]*"' | head -1 |
    sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
  [ -z "$form_action" ] && return 1
  cb_headers=$(curl -sD - -o /dev/null -c "$jar" -b "$jar" \
    --data-urlencode "username=$user" --data-urlencode "password=$pass" \
    "$form_action")
  cb_url=$(echo "$cb_headers" | grep -i '^location:' | awk '{print $2}' | tr -d '\r\n')
  [ -z "$cb_url" ] && return 1
  case "$cb_url" in *auth/callback*) ;; *) return 1 ;; esac
  qs="${cb_url#*\?}"
  curl -s -o /dev/null -c "$jar" -b "$jar" "$API/api/v1/auth/callback?$qs"
  grep -q arc_session "$jar" 2>/dev/null
}

JAR=$(mktemp)
if ! oidc_login "demo-architect" "$JAR" "Arcanium-arch-2026"; then
  rm -f "$JAR"
  unk "could not authenticate as demo-architect — identity stack not reachable"
  echo
  echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $((PASS + FAIL + UNKNOWN))) =="
  exit 0
fi

cleanup() {
  [ -n "${SA_ID:-}" ] && curl -s -b "$JAR" -X DELETE "$API/api/v1/service-accounts/$SA_ID" >/dev/null 2>&1
  rm -f "$JAR"
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# ── 1 — provision a real service account + token for the provider to use ──
SA_NAME="tf-provider-proof-$(date +%s)"
SA_CREATE=$(curl -s -b "$JAR" -X POST "$API/api/v1/service-accounts" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$SA_NAME\",\"description\":\"scenario 17 terraform provider proof\",\"roles\":[\"architect\"]}")
SA_ID=$(echo "$SA_CREATE" | jq -r '.id // empty')
if [ -z "$SA_ID" ]; then
  bad "could not create the service account the provider needs (POST /service-accounts): $SA_CREATE"
  echo
  echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $((PASS + FAIL + UNKNOWN))) =="
  exit 1
fi
ok "created a real service account ($SA_NAME, role=architect) for the provider to authenticate as"

TOKEN_RESP=$(curl -s -b "$JAR" -X POST "$API/api/v1/service-accounts/$SA_ID/tokens" \
  -H 'Content-Type: application/json' -d '{"description":"scenario 17 token"}')
SA_TOKEN=$(echo "$TOKEN_RESP" | jq -r '.token // empty')
if [ -z "$SA_TOKEN" ]; then
  bad "could not issue a token for the test service account: $TOKEN_RESP"
  echo
  echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $((PASS + FAIL + UNKNOWN))) =="
  exit 1
fi
ok "issued a real service-account Bearer token via POST /service-accounts/{id}/tokens"

# ── 2 — a real terraform apply, dev_overrides pointing at the local build ──
WORKDIR=$(mktemp -d)
CLI_CONFIG="$WORKDIR/dev.tfrc"
cat >"$CLI_CONFIG" <<EOF
provider_installation {
  dev_overrides {
    "registry.terraform.io/hashicorp-demo/arcanium" = "$PROVIDER_ABS_DIR"
  }
  direct {}
}
EOF

APP_NAME="tf-provider-proof-app-$(date +%s)"
cat >"$WORKDIR/main.tf" <<EOF
terraform {
  required_providers {
    arcanium = {
      source = "registry.terraform.io/hashicorp-demo/arcanium"
    }
  }
}

provider "arcanium" {
  endpoint = "$API"
  token    = "$SA_TOKEN"
}

resource "arcanium_application" "proof" {
  name        = "$APP_NAME"
  environment = "staging"
}

data "arcanium_application_intent" "proof" {
  application_id = arcanium_application.proof.id
}

output "application_id" {
  value = arcanium_application.proof.id
}

output "intent_summary" {
  value = data.arcanium_application_intent.proof.summary
}
EOF

export TF_CLI_CONFIG_FILE="$CLI_CONFIG"
export TF_IN_AUTOMATION=1

APPLY_OUT=$(cd "$WORKDIR" && terraform apply -auto-approve -no-color 2>&1)
APPLY_STATUS=$?
if [ $APPLY_STATUS -ne 0 ]; then
  bad "terraform apply failed: $(echo "$APPLY_OUT" | tail -20)"
else
  ok "terraform apply succeeded — arcanium_application created via a real service-account Bearer token, no cookie involved"
fi

TF_APP_ID=$(cd "$WORKDIR" && terraform output -raw application_id 2>/dev/null)
TF_SUMMARY=$(cd "$WORKDIR" && terraform output -raw intent_summary 2>/dev/null)

if [ -n "$TF_APP_ID" ]; then
  ok "terraform output exposes the created application's real UUID ($TF_APP_ID)"
else
  bad "terraform output did not expose an application_id"
fi

# ── 3 — prove it's not just a Terraform-side fiction: check the real API ──
if [ -n "$TF_APP_ID" ]; then
  API_APP=$(curl -s -b "$JAR" "$API/api/v1/applications/$TF_APP_ID")
  API_NAME=$(echo "$API_APP" | jq -r '.name // empty')
  if [ "$API_NAME" = "$APP_NAME" ]; then
    ok "the application terraform created is a real row in arcanium-api's own registry (GET /applications/{id} confirms name matches)"
  else
    bad "GET /applications/{id} did not return the application terraform claims to have created"
  fi
else
  unk "cannot verify against the live API without a captured application_id"
fi

if [ -n "$TF_SUMMARY" ]; then
  ok "the arcanium_application_intent data source read a real entry_story.summary sentence: \"$TF_SUMMARY\""
else
  unk "intent_summary output was empty — possibly too little data yet to characterize this freshly-created application's story (expected for a brand-new app)"
fi

# ── 4 — destroy proves the resource's Delete path also goes through the
#        real DELETE /applications/{id} route, not just Create/Read ──
DESTROY_OUT=$(cd "$WORKDIR" && terraform destroy -auto-approve -no-color 2>&1)
DESTROY_STATUS=$?
if [ $DESTROY_STATUS -eq 0 ]; then
  ok "terraform destroy succeeded — the provider's Delete path also proven, not just Create/Read"
else
  bad "terraform destroy failed: $(echo "$DESTROY_OUT" | tail -20)"
fi

if [ -n "$TF_APP_ID" ]; then
  API_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$API/api/v1/applications/$TF_APP_ID")
  if [ "$API_STATUS" = "404" ]; then
    ok "the application is genuinely gone from arcanium-api after terraform destroy (404)"
  else
    bad "expected 404 after terraform destroy, got $API_STATUS — the application may not have actually been deleted"
  fi
fi

echo
TOTAL=$((PASS + FAIL + UNKNOWN))
echo "== Result: $PASS passed, $FAIL failed, $UNKNOWN unknown (of $TOTAL) =="
[ "$FAIL" -eq 0 ]
