#!/usr/bin/env bash
# capture-state.sh — build one baseline under state/baselines/<id>/.
#
# Three tiers, per input/37:
#   source     — exactly which code formed this baseline (git, file hashes, tool versions)
#   deployment — what is actually running (containers, images, config MODE flags — never values)
#   observed   — functional checks against live endpoints (health, isolation, maturity)
#
# Hard rule: never write a secret to disk. No .env values beyond an explicit
# non-secret allowlist, no `podman inspect`, no `podman compose config`
# (resolves .env substitution — exactly the leak input/37 warns about), no
# Vault token, no full process environment. Prefer whitelisted fields over
# capturing-then-redacting.
#
# Every check sets its own status — CAPTURED / PARTIAL / UNKNOWN / FAILED —
# recorded in manifest.yaml. A check that can't run says so; it never leaves
# an empty file that later reads as "no problems found".
#
# Usage:
#   state/scripts/capture-state.sh <baseline-id> ["purpose text"] [--with-scenarios]
#
# Examples:
#   state/scripts/capture-state.sh 2026-09-11_pre-hardening "baseline before Prompt 18"
#   state/scripts/capture-state.sh 2026-09-20_post-18-security "after Phase 18" --with-scenarios
set -uo pipefail
cd "$(dirname -- "$0")/../.." # -> repo root

BASELINE_ID="${1:?usage: capture-state.sh <baseline-id> [purpose] [--with-scenarios]}"
shift || true
PURPOSE="baseline capture"
WITH_SCENARIOS=false
for arg in "$@"; do
  case "$arg" in
  --with-scenarios) WITH_SCENARIOS=true ;;
  *) PURPOSE="$arg" ;;
  esac
done

BASE="state/baselines/${BASELINE_ID}"
if [ -d "$BASE" ]; then
  echo "error: $BASE already exists — baselines are never overwritten in place." >&2
  echo "Pick a new id, or remove the directory yourself first if this was a mistake." >&2
  exit 1
fi
mkdir -p "$BASE"/{source,runtime,arcanium,vault,hsm,infra,kms,observability,workloads,scenarios}

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
declare -A STATUS # check-name -> CAPTURED|PARTIAL|UNKNOWN|FAILED

set_status() { STATUS["$1"]="$2"; }

# The Podman machine socket on this host is intermittently flaky (drops and
# recovers within a second or two — a known local issue, not a real
# stopped-stack signal). A single failed `podman ps` must not be recorded as
# "not running"; retry briefly before believing it.
podman_ok() {
  local attempt
  for attempt in 1 2 3; do
    podman ps >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

running() {
  local attempt
  for attempt in 1 2 3; do
    if podman ps --format '{{.Names}}' 2>/dev/null | grep -qx "$1"; then return 0; fi
    podman ps >/dev/null 2>&1 || {
      sleep 1
      continue
    }
    return 1 # podman answered, container just isn't in the list
  done
  return 1
}

# ---------------------------------------------------------------- source --
capture_source() {
  local ok=true

  git rev-parse HEAD >"$BASE/source/git.txt" 2>/dev/null || ok=false
  {
    echo "branch: $(git branch --show-current 2>/dev/null || echo unknown)"
    echo "tag: $(git describe --tags --exact-match 2>/dev/null || echo none)"
  } >>"$BASE/source/git.txt"

  git status --short >"$BASE/source/git-status.txt" 2>/dev/null || ok=false
  local dirty=false
  [ -s "$BASE/source/git-status.txt" ] && dirty=true

  git diff HEAD -- . >"$BASE/source/diff.patch" 2>/dev/null || true

  jq -n \
    --arg node "$(node --version 2>/dev/null || echo unknown)" \
    --arg terraform "$(terraform -version 2>/dev/null | head -1 || echo unknown)" \
    --arg vault_cli "$(vault version 2>/dev/null || echo unknown)" \
    --arg podman "$(podman --version 2>/dev/null || echo unknown)" \
    '{node:$node, terraform:$terraform, vault_cli:$vault_cli, podman:$podman}' \
    >"$BASE/source/versions.json"

  # Whitelisted file hashes only — compose + terraform definitions, never .env.
  {
    find compose -name 'compose.yaml' -o -name 'compose.yml' 2>/dev/null
    find terraform -name '*.tf' 2>/dev/null
  } | sort | xargs shasum -a 256 >"$BASE/source/hashes.sha256" 2>/dev/null || ok=false

  $ok && set_status source CAPTURED || set_status source PARTIAL
  echo "  git dirty: $dirty"
}

# --------------------------------------------------------------- runtime --
capture_runtime() {
  if ! podman_ok; then
    for f in containers.json images.json networks.json; do
      echo '{"status":"UNKNOWN","detail":"podman unreachable at capture time"}' >"$BASE/runtime/$f"
    done
    echo "podman unreachable at capture time" >"$BASE/runtime/volumes.txt"
    set_status runtime UNKNOWN
    return
  fi

  # Whitelisted fields only: never podman inspect (pulls full env), never
  # podman compose config (resolves .env substitution).
  podman ps -a --format json 2>/dev/null |
    jq '[.[] | {name: .Names[0], image: .Image, state: .State, status: .Status,
                   ports: (.Ports // []), networks: (.Networks // [])}]' \
      >"$BASE/runtime/containers.json" || echo '[]' >"$BASE/runtime/containers.json"

  podman images --format json 2>/dev/null |
    jq '[.[] | {repository: (.Names[0] // "none"), id: .Id, digest: (.Digest // "unknown"),
                   size: .Size, created: .CreatedAt}]' \
      >"$BASE/runtime/images.json" || echo '[]' >"$BASE/runtime/images.json"

  podman network ls --format json 2>/dev/null |
    jq '[.[] | {name: .Name, driver: .Driver}]' \
      >"$BASE/runtime/networks.json" || echo '[]' >"$BASE/runtime/networks.json"

  podman volume ls --format '{{.Name}}' 2>/dev/null >"$BASE/runtime/volumes.txt" || true

  set_status runtime CAPTURED
}

# -------------------------------------------------------------- arcanium --
# Non-secret .env allowlist — MODE flags only, never a value that could be a
# credential. Extend this list deliberately; never widen it to "everything".
ENV_ALLOWLIST="ARCANIUM_AUTH_ENABLED ARCANIUM_DEMO_PERSONA_SWITCH PROVISION_MODE NODE_ENV POSTGRES_DB"

capture_arcanium() {
  local health_ok=false

  {
    echo "{"
    local first=true
    for key in $ENV_ALLOWLIST; do
      local val
      val="$(grep -E "^${key}=" .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
      [ -z "$val" ] && val="(unset)"
      $first || echo ","
      first=false
      printf '  "%s": %s' "$key" "$(jq -Rn --arg v "$val" '$v')"
    done
    echo
    echo "}"
  } >"$BASE/arcanium/capabilities.json"

  if running arcanium-api; then
    if curl -fsS --max-time 5 http://localhost:3001/health >"$BASE/arcanium/health.json" 2>/dev/null ||
      curl -fsS --max-time 5 http://localhost:3001/api/v1/health >"$BASE/arcanium/health.json" 2>/dev/null; then
      health_ok=true
    else
      echo '{"status":"UNKNOWN","detail":"arcanium-api running but health endpoint did not respond"}' >"$BASE/arcanium/health.json"
    fi

    curl -fsS --max-time 5 http://localhost:3001/api/v1/maturity 2>/dev/null \
      >"$BASE/arcanium/api-smoke.json" ||
      echo '{"status":"UNKNOWN","detail":"maturity endpoint did not respond"}' >"$BASE/arcanium/api-smoke.json"
  else
    echo '{"status":"UNKNOWN","detail":"arcanium-api not running"}' >"$BASE/arcanium/health.json"
    echo '{"status":"UNKNOWN","detail":"arcanium-api not running"}' >"$BASE/arcanium/api-smoke.json"
  fi

  ls arcanium/api/src/migrations/ 2>/dev/null >"$BASE/arcanium/migrations.txt" || echo "(migrations dir unreadable)" >"$BASE/arcanium/migrations.txt"

  if $health_ok; then
    set_status arcanium CAPTURED
  elif running arcanium-api; then
    set_status arcanium PARTIAL
  else
    set_status arcanium UNKNOWN
  fi
}

# ------------------------------------------------------------------ vault --
capture_vault() {
  # shellcheck source=scripts/vault-common.sh
  if ! running arcanium-vault_1; then
    for f in cluster.json mounts.json auth-methods.json audit-devices.json namespaces.json policies-summary.json; do
      echo '{"status":"UNKNOWN","detail":"vault-1 not running"}' >"$BASE/vault/$f"
    done
    set_status vault UNKNOWN
    return
  fi

  source scripts/vault-common.sh 2>/dev/null

  local nodes_json="[]"
  for node in vault-s vault-1 vault-2 vault-3; do
    vault_node "$node"
    local s
    if s=$(vault_json 2>/dev/null); then
      nodes_json=$(jq --argjson n "$s" --arg name "$node" '. + [{node:$name, initialized:$n.initialized, sealed:$n.sealed, seal_type:$n.type, version:$n.version}]' <<<"$nodes_json")
    else
      nodes_json=$(jq --arg name "$node" '. + [{node:$name, reachable:false}]' <<<"$nodes_json")
    fi
  done
  echo "$nodes_json" | jq '{nodes: .}' >"$BASE/vault/cluster.json"

  # Authenticated, metadata-only reads. Token comes from the existing local
  # secrets file via vault_root — used only to authenticate this process,
  # never written to any output file.
  local vault_status="PARTIAL"
  if vault_node vault-1 && vault_root cluster 2>/dev/null; then
    vault secrets list -format=json 2>/dev/null >"$BASE/vault/mounts.json" ||
      echo '{"status":"UNKNOWN"}' >"$BASE/vault/mounts.json"
    vault auth list -format=json 2>/dev/null >"$BASE/vault/auth-methods.json" ||
      echo '{"status":"UNKNOWN"}' >"$BASE/vault/auth-methods.json"
    vault audit list -format=json 2>/dev/null >"$BASE/vault/audit-devices.json" ||
      echo '{"status":"UNKNOWN"}' >"$BASE/vault/audit-devices.json"
    vault namespace list -format=json 2>/dev/null >"$BASE/vault/namespaces.json" ||
      echo '[]' >"$BASE/vault/namespaces.json"
    vault policy list -format=json 2>/dev/null | jq '{acl: .}' >"$BASE/vault/policies-summary.json" 2>/dev/null ||
      echo '{"status":"UNKNOWN"}' >"$BASE/vault/policies-summary.json"
    unset VAULT_TOKEN
    vault_status="CAPTURED"
  else
    for f in mounts.json auth-methods.json audit-devices.json namespaces.json policies-summary.json; do
      echo '{"status":"UNKNOWN","detail":"could not authenticate for metadata read"}' >"$BASE/vault/$f"
    done
  fi

  set_status vault "$vault_status"
}

# -------------------------------------------------------------------- hsm --
capture_hsm() {
  local st="UNKNOWN"
  if running arcanium-vault_hsm; then st="PARTIAL"; fi
  if running arcanium-softhsm_server; then st="PARTIAL"; fi
  if running arcanium-vault_hsm && running arcanium-softhsm_server; then st="CAPTURED"; fi

  jq -n --arg vault_hsm "$(running arcanium-vault_hsm && echo running || echo down)" \
    --arg softhsm "$(running arcanium-softhsm_server && echo running || echo down)" \
    --arg impl "SoftHSM/PKCS11 (emulated HSM, not a production HSM)" \
    '{vault_hsm: $vault_hsm, softhsm_proxy: $softhsm, implementation: $impl}' \
    >"$BASE/hsm/status.json"

  echo "not captured in this baseline — requires an authenticated container exec against softhsm; deferred, not fabricated" \
    >"$BASE/hsm/pkcs11-slots.txt"
  echo '{"status":"UNKNOWN","detail":"Managed Key inventory not queried in this capture — see vault/mounts.json for the keymgmt mount presence instead"}' \
    >"$BASE/hsm/managed-keys.json"

  set_status hsm "$st"
}

# ------------------------------------------------------------------ infra --
capture_infra() {
  local st="UNKNOWN"
  if running arcanium-postgres; then
    st="CAPTURED"
    jq -n '{postgres: "running", note: "no query executed against the database — container status only"}' \
      >"$BASE/infra/postgres.json"
  else
    echo '{"status":"UNKNOWN","detail":"arcanium-postgres not running"}' >"$BASE/infra/postgres.json"
  fi
  ls arcanium/api/src/migrations/ 2>/dev/null >"$BASE/infra/schema.txt" || echo "(unreadable)" >"$BASE/infra/schema.txt"
  set_status infra "$st"
}

# -------------------------------------------------------------------- kms --
capture_kms() {
  if running arcanium-localstack; then
    if curl -fsS --max-time 5 http://localhost:4566/_localstack/health >"$BASE/kms/status.json" 2>/dev/null; then
      set_status kms CAPTURED
    else
      echo '{"status":"PARTIAL","detail":"container running, health endpoint did not respond"}' >"$BASE/kms/status.json"
      set_status kms PARTIAL
    fi
  else
    echo '{"status":"UNKNOWN","detail":"kms-sim (LocalStack) not running","emulated":true}' >"$BASE/kms/status.json"
    set_status kms UNKNOWN
  fi
}

# ---------------------------------------------------------- observability --
capture_observability() {
  local containers
  containers=$(podman ps --format '{{.Names}}' 2>/dev/null | grep -E 'arcanium-(prometheus|grafana|otel-collector)$' || true)
  jq -n --arg containers "$containers" '{running_containers: ($containers | split("\n") | map(select(length>0)))}' \
    >"$BASE/observability/status.json"

  if curl -fsS --max-time 5 http://localhost:9090/api/v1/targets 2>/dev/null |
    jq '{activeTargets: [.data.activeTargets[]? | {job: .labels.job, health: .health}]}' \
      >"$BASE/observability/targets.json" 2>/dev/null; then
    set_status observability CAPTURED
  else
    echo '{"status":"UNKNOWN","detail":"prometheus targets endpoint not reachable"}' >"$BASE/observability/targets.json"
    [ -n "$containers" ] && set_status observability PARTIAL || set_status observability UNKNOWN
  fi
}

# -------------------------------------------------------------- workloads --
capture_workloads() {
  local names
  names=$(podman ps -a --format '{{.Names}}' 2>/dev/null | grep -E 'arcanium-(payments-api|pki-client|kmip-client|document-signing|external-supplier)$' || true)
  if [ -z "$names" ]; then
    echo '{"status":"UNKNOWN","detail":"no workload containers found"}' >"$BASE/workloads/status.json"
    echo '[]' >"$BASE/workloads/inventory.json"
    set_status workloads UNKNOWN
    return
  fi
  podman ps -a --format json 2>/dev/null |
    jq '[.[] | select(.Names[0] | test("arcanium-(payments-api|pki-client|kmip-client|document-signing|external-supplier)$")) | {name: .Names[0], state: .State, status: .Status}]' \
      >"$BASE/workloads/inventory.json"
  jq '{count: length, running: [.[] | select(.state=="running")] | length}' "$BASE/workloads/inventory.json" \
    >"$BASE/workloads/status.json"
  set_status workloads CAPTURED
}

# ------------------------------------------------------------- scenarios --
capture_scenarios() {
  local results="[]"

  # Always-safe: the supplier isolation check is a live-but-non-mutating
  # verification the API itself performs continuously for the dashboard
  # (mints ephemeral tokens, checks 403, doesn't touch persistent state).
  if running arcanium-api; then
    local iso
    if iso=$(curl -fsS --max-time 10 http://localhost:3001/api/v1/suppliers/isolation 2>/dev/null); then
      local verified
      verified=$(jq -r '.verified // false' <<<"$iso" 2>/dev/null || echo false)
      results=$(jq --arg v "$([ "$verified" = true ] && echo PASS || echo FAIL)" \
        '. + [{check:"supplier_isolation", result:$v, method:"live API check, non-mutating"}]' <<<"$results")
    else
      results=$(jq '. + [{check:"supplier_isolation", result:"UNKNOWN", detail:"endpoint did not respond"}]' <<<"$results")
    fi
  else
    results=$(jq '. + [{check:"supplier_isolation", result:"UNKNOWN", detail:"arcanium-api not running"}]' <<<"$results")
  fi

  local mutating_checks="onboarding transit pki kmip managed_key sentinel_negative"
  if $WITH_SCENARIOS; then
    # Opt-in only: these scenario scripts create/rotate/destroy real
    # resources against the running demo estate. Not run unless the caller
    # explicitly passed --with-scenarios.
    results=$(jq '. + [{check:"onboarding", result:"UNKNOWN", detail:"scenario runner wiring not implemented yet — run scenarios/01_onboarding manually and record the result"}]' <<<"$results")
  else
    for c in $mutating_checks; do
      results=$(jq --arg c "$c" '. + [{check:$c, result:"UNKNOWN", detail:"not run — mutating scenario, requires --with-scenarios and creates/changes real resources"}]' <<<"$results")
    done
  fi

  echo "$results" | jq '{results: .}' >"$BASE/scenarios/results.json"
  {
    echo "# Scenario verification — ${BASELINE_ID}"
    echo
    jq -r '.results[] | "- **\(.check)**: \(.result)" + (if .detail then " — \(.detail)" else "" end)' <<<"$(echo "$results" | jq '{results:.}')"
  } >"$BASE/scenarios/summary.md"

  local any_fail any_unknown
  any_fail=$(jq -e '[.[] | select(.result=="FAIL")] | length > 0' <<<"$results" 2>/dev/null && echo true || echo false)
  any_unknown=$(jq -e '[.[] | select(.result=="UNKNOWN")] | length > 0' <<<"$results" 2>/dev/null && echo true || echo false)
  if [ "$any_fail" = true ]; then
    set_status scenarios FAILED
  elif [ "$any_unknown" = true ]; then
    set_status scenarios PARTIAL
  else
    set_status scenarios CAPTURED
  fi
}

echo "Capturing baseline: $BASE"
echo "  purpose: $PURPOSE"
echo

for fn in capture_source capture_runtime capture_arcanium capture_vault capture_hsm capture_infra capture_kms capture_observability capture_workloads capture_scenarios; do
  echo "-> ${fn#capture_}"
  "$fn"
done

# ------------------------------------------------------------- manifest ---
overall="CAPTURED"
for v in "${STATUS[@]}"; do
  case "$v" in
  FAILED) overall="PARTIAL" ;;
  PARTIAL | UNKNOWN) [ "$overall" = CAPTURED ] && overall="PARTIAL" ;;
  esac
done

{
  echo "baseline:"
  echo "  id: ${BASELINE_ID}"
  echo "  purpose: \"${PURPOSE}\""
  echo "  captured_at: ${TS}"
  echo "  git:"
  echo "    commit: \"$(git rev-parse HEAD 2>/dev/null || echo unknown)\""
  echo "    branch: \"$(git branch --show-current 2>/dev/null || echo unknown)\""
  echo "    tag: \"$(git describe --tags --exact-match 2>/dev/null || echo none)\""
  echo "    dirty: $([ -s "$BASE/source/git-status.txt" ] && echo true || echo false)"
  echo
  echo "runtime:"
  echo "  engine: podman"
  echo "  architecture: \"$(uname -m)\""
  echo
  echo "components:"
  for c in arcanium vault hsm infra kms observability workloads; do
    echo "  ${c}:"
    echo "    capture_status: ${STATUS[$c]:-UNKNOWN}"
  done
  echo
  echo "verification:"
  jq -r '.results[] | "  \(.check): \(.result)"' "$BASE/scenarios/results.json"
  echo
  echo "capture:"
  echo "  overall: ${overall}"
  echo "  checks:"
  for c in source runtime arcanium vault hsm infra kms observability workloads scenarios; do
    echo "    ${c}: ${STATUS[$c]:-UNKNOWN}"
  done
} >"$BASE/manifest.yaml"

# ------------------------------------------------------------- summary.md -
AUTH_ENABLED="$(jq -r '.ARCANIUM_AUTH_ENABLED // "(unset)"' "$BASE/arcanium/capabilities.json" 2>/dev/null)"
{
  echo "# Arcanium baseline — ${BASELINE_ID}"
  echo
  echo "**Purpose:** ${PURPOSE}"
  echo "**Captured:** ${TS}"
  echo "**Overall capture status:** ${overall}"
  echo
  echo "## Characteristics at capture time"
  echo
  echo '```text'
  echo "AuthN"
  echo "  ARCANIUM_AUTH_ENABLED = ${AUTH_ENABLED}"
  echo "  Vault userpass (pre-Phase-18)"
  echo
  echo "AuthZ"
  echo "  Persona based, username -> persona map"
  echo "  Not yet OIDC group backed"
  echo
  echo "Desired state / Reconciliation"
  echo "  Not implemented (pre-Phase-19)"
  echo
  echo "Evidence"
  echo "  v1 / heuristic (pre-Phase-21 in this repo's numbering)"
  echo
  echo "Maturity"
  echo "  Averaged model, not gated"
  echo
  echo "OpenAPI"
  echo "  Not authoritative (pre-Phase-20)"
  echo
  echo "Recovery"
  echo "  Backups available, restore not yet proven (pre-Phase-22)"
  echo '```'
  echo
  echo "## Capture status per check"
  echo
  echo "| Check | Status |"
  echo "|---|---|"
  for c in source runtime arcanium vault hsm infra kms observability workloads scenarios; do
    echo "| $c | ${STATUS[$c]:-UNKNOWN} |"
  done
  echo
  echo "See [manifest.yaml](./manifest.yaml) for the machine-readable form, and"
  echo "[scenarios/summary.md](./scenarios/summary.md) for the observed-functional-state results."
} >"$BASE/summary.md"

echo "$BASE" >state/CURRENT

echo
echo "Baseline written: $BASE"
echo "Overall: $overall"
echo "CURRENT -> $BASE"
