#!/usr/bin/env bash
# scripts/rehydrate-stack.sh — Pre-24, Deliverable 3.
#
# One top-level orchestrator over the EXISTING, already-idempotent
# bootstrap scripts and Make targets — deliberately not a monolithic
# reimplementation. Every step below is something `make <target>` already
# does on its own; this just calls them in real dependency order and
# stops on the first hard failure (fail-fast on a required dependency;
# optional/license-gated steps are explicit about being skipped, never
# silently swallowed).
#
# Idempotent end to end: vault-bootstrap.sh refuses to reinitialize an
# already-initialized cluster, hsm-init skips if its init file exists,
# identity-bootstrap's ensure_* functions reconcile rather than recreate,
# terraform apply is idempotent by construction, onboarding.sh/
# provision.sh check for existing registrations before creating.
# Running this script twice must not create duplicate tenants,
# applications, identities, policies, or desired-state rows — this is
# exercised directly by scenarios/pre_24_persistence/test_restart_persistence.sh.
#
# Usage:
#   scripts/rehydrate-stack.sh            # full sequence
#   scripts/rehydrate-stack.sh --core     # steps 1-9 only (no workloads/observability/kms-sim)
#   scripts/rehydrate-stack.sh --from N   # resume from step N (see `list`)
#   scripts/rehydrate-stack.sh list       # print the numbered steps and exit

set -euo pipefail
ROOT=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

CORE_ONLY=false
FROM=1
case "${1:-}" in
--core) CORE_ONLY=true ;;
--from)
  FROM="${2:?--from requires a step number}"
  ;;
list) ;;
"") ;;
*)
  echo "Usage: $0 [--core] [--from N] [list]" >&2
  exit 64
  ;;
esac

SHOW_LIST=false
[ "${1:-}" = list ] && SHOW_LIST=true

STEP=0
run() {
  # run <description> -- <command...>
  local desc="$1"
  STEP=$((STEP + 1))
  if [ "$SHOW_LIST" = true ]; then
    printf '  %2d. %s\n' "$STEP" "$desc"
    return 0
  fi
  [ "$STEP" -ge "$FROM" ] || return 0
  echo
  echo "── step $STEP: $desc ──────────────────────────────────────"
  shift
  "$@"
}

optional() {
  # optional <description> <condition-command> -- <command...>
  # Skips (not fails) when the condition command fails, printing why.
  local desc="$1" cond="$2"
  STEP=$((STEP + 1))
  if [ "$SHOW_LIST" = true ]; then
    printf '  %2d. %s (optional)\n' "$STEP" "$desc"
    return 0
  fi
  [ "$STEP" -ge "$FROM" ] || return 0
  echo
  echo "── step $STEP: $desc (optional) ────────────────────────"
  if ! eval "$cond"; then
    echo "  skipped — $cond is false"
    return 0
  fi
  shift 2
  "$@"
}

if [ "$SHOW_LIST" = true ]; then
  echo "Full rehydration sequence:"
fi

run "network" make network
run "Vault: prepare TLS/license material" make vault-prepare
run "Vault: bootstrap main cluster + vault-s (idempotent — no-op if already initialized)" make vault-up
run "Vault: status check" make vault-status

# Every `make tf-*` target below assumes an already-authenticated
# VAULT_TOKEN in the caller's shell (docs/local-dependency-audit.md
# finding 5) — true for an interactive operator who ran `vault login`,
# false for this script running non-interactively. Self-authenticate the
# same way scripts/workload-credentials.sh does: the cluster's own root
# token from .secrets/vault, never requiring a prior manual login. Only
# done once the cluster is confirmed up (the two steps above) — this file
# does not exist before `make vault-up` has run at least once.
# Not gated on $STEP/$FROM (unlike the numbered steps around it) — a
# --from resume must still get a fresh token, and re-exporting an already-
# valid one is harmless and idempotent.
if [ -f .secrets/vault/cluster-init.json ]; then
  export VAULT_ADDR=https://127.0.0.1:18200
  export VAULT_CACERT="$ROOT/vault-tls/ca-chain.pem"
  export VAULT_TOKEN
  VAULT_TOKEN=$(jq -er '.root_token' .secrets/vault/cluster-init.json)
fi

run "Terraform: platform baseline (auth, policies, namespaces, audit)" make tf-platform
run "Terraform: transit + pki + database" bash -c "make tf-transit && make tf-pki && make tf-database"
run "infra: PostgreSQL (+ adminer)" make infra-up
run "HSM: softhsm-server + vault-hsm (idempotent — hsm-init skips if already initialized)" bash -c "make hsm-bootstrap && make hsm-init"
optional "HSM: Managed Key + document-signing-key (needs SoftHSM slot resolved above)" \
  "[ -f .secrets/hsm/slot-id ]" \
  make hsm-managed-keys
run "identity: OpenLDAP + Keycloak" make identity-up
run "identity: LDAP fixture + Keycloak realm/client/federation (idempotent — ensure_* reconciles, never recreates)" make identity-bootstrap
run "Terraform: workloads + kmip + suppliers (seeded demo tenants)" bash -c "make tf-workloads && make tf-kmip && make tf-suppliers"
run "Arcanium: API/UI/worker (migrations run inline on API startup, idempotent)" make arcanium-up
run "workload credentials: arcanium-api, arcanium-hsm-read, document-signing" \
  ./scripts/workload-credentials.sh issue-all
run "workload credentials: onboarding (payments/pki + app registration)" make onboarding
run "workload credentials: supplier isolation (pepsi/cocacola app+approver)" make supplier-provision
run "workload credentials: approval demo (external-supplier/approver-1)" make approval-provision

if [ "$CORE_ONLY" != true ]; then
  run "workloads: payments-api, pki-client, kmip-client, document-signing, external-supplier" make workloads-up
  optional "observability: Prometheus/Grafana/OTel" true make observability-up
  optional "KMS simulation: LocalStack" true make kms-sim-up
fi

run "verify" make verify

[ "$SHOW_LIST" = true ] && exit 0
echo
echo "== rehydrate-stack.sh: sequence complete =="
