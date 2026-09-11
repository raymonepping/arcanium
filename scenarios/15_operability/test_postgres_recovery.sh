#!/usr/bin/env bash
# scenarios/15_operability/test_postgres_recovery.sh — Prompt 24, Deliverable 7.
# Drill B — PostgreSQL loss. The canonical exit criterion for this phase.
#
# Per input/34: "Destroy and rebuild a component, recover it using
# documented procedure, and measure the result rather than assuming
# recovery works." Per input/36, Postgres loss and Vault-node loss are
# fundamentally different recovery procedures — this is Drill B, the
# Postgres-specific sibling to Drill A (scripts/vault-restore-drill.sh),
# not a substitute for it.
#
# THIS SCRIPT STOPS, REMOVES, AND DELETES THE VOLUME OF arcanium-postgres —
# the actual running database, not an isolated copy. It then recreates it
# from scratch and restores from a pg_dump taken as step 2 of this same
# run. Real data loss is possible if the restore step fails; do not run
# this against a stack you cannot afford to lose without first confirming
# a separate backup exists.
set -uo pipefail
cd "$(dirname -- "$0")/../.." # -> repo root
umask 077

KNOWN_APP_NAME="${KNOWN_APP_NAME:-payments-api}"
DUMP_DIR="backups/pg-recovery-drill-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DUMP_DIR"
DUMP_FILE="$DUMP_DIR/arcanium_db.sql"

RESULT="UNKNOWN"
DETAIL=""

record_result() {
  local started="$1" completed="$2" rto="$3" rpo="$4" verified="$5" detail="$6"
  podman exec -i arcanium-postgres psql -U arcanium -d arcanium_db -v ON_ERROR_STOP=1 >/dev/null <<SQL
INSERT INTO restore_drill_results (component, started_at, completed_at, rto_seconds, rpo_seconds, verified, detail)
VALUES ('postgres', to_timestamp($started), to_timestamp($completed), $rto, $rpo, $verified, '$detail'::jsonb);
SQL
}

# Snapshot exactly the fields Deliverable 7's step 1/7 asks for: the known
# application, its key metadata, its rotation status, and its most recent
# job/evidence rows. One JSON blob, queried the same way before and after,
# so "restored" means "this diff is empty," not "the container is up."
snapshot() {
  podman exec -i arcanium-postgres psql -U arcanium -d arcanium_db -t -A -c "
    select coalesce(jsonb_pretty(jsonb_build_object(
      'app', (select jsonb_build_object('id', id, 'name', name, 'category', category)
              from applications where name = '$KNOWN_APP_NAME'),
      'profiles', (select coalesce(jsonb_agg(jsonb_build_object(
                      'vault_path', vault_path, 'type', type,
                      'rotation_days', rotation_days, 'custody', custody
                    ) order by vault_path), '[]'::jsonb)
                   from crypto_profiles cp
                   join applications a on a.id = cp.application_id
                   where a.name = '$KNOWN_APP_NAME'),
      'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', id, 'action', action, 'status', status, 'updated_at', updated_at
                ) order by created_at desc), '[]'::jsonb)
               from (select pj.id, pj.action, pj.status, pj.updated_at, pj.created_at
                     from provisioning_jobs pj
                     join applications a on a.id::text = pj.target_id
                     where a.name = '$KNOWN_APP_NAME' and pj.target_type = 'application'
                     order by pj.created_at desc limit 5) j),
      'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
                      'operation', operation, 'resource_id', resource_id, 'outcome', outcome
                    ) order by ts desc), '[]'::jsonb)
                   from (select operation, resource_id, outcome, ts
                         from evidence
                         where resource_id in (
                           select regexp_replace(vault_path, '^.*/', '')
                           from crypto_profiles cp join applications a on a.id = cp.application_id
                           where a.name = '$KNOWN_APP_NAME'
                         )
                         order by ts desc limit 5) ev)
    )), '{}') " 2>/dev/null
}

# The last-write timestamp the dump actually contains, relative to which
# RPO below is measured — not a fixed assumption.
last_write_ts() {
  podman exec -i arcanium-postgres psql -U arcanium -d arcanium_db -t -A -c "
    select extract(epoch from greatest(
      coalesce((select max(updated_at) from provisioning_jobs), 'epoch'),
      coalesce((select max(created_at) from evidence), 'epoch')
    ))::bigint;" 2>/dev/null
}

echo "[pg-recovery] step 1/10: recording current state ($KNOWN_APP_NAME)"
BEFORE=$(snapshot)
if [ -z "$BEFORE" ] || [ "$BEFORE" = "{}" ]; then
  echo "[pg-recovery] could not find application '$KNOWN_APP_NAME' — set KNOWN_APP_NAME to an app that exists (see 'GET /api/v1/applications')." >&2
  exit 1
fi
echo "$BEFORE" >"$DUMP_DIR/before.json"
echo "  snapshot saved: $DUMP_DIR/before.json"

echo "[pg-recovery] step 2/10: pg_dump (this IS the backup — not assumed to already exist)"
podman exec -i arcanium-postgres pg_dump -U arcanium arcanium_db >"$DUMP_FILE"
DUMP_SIZE=$(wc -c <"$DUMP_FILE" | tr -d ' ')
echo "  pg_dump saved: $DUMP_FILE ($DUMP_SIZE bytes)"
RPO_BASELINE=$(last_write_ts)

echo "[pg-recovery] step 3/10: destroying PostgreSQL (container + volume)"
STARTED=$(date +%s)
./scripts/compose.sh infra stop postgres >/dev/null 2>&1 || true
podman rm -f arcanium-postgres >/dev/null 2>&1 || true
podman volume rm -f arcanium-infra_postgres-data >/dev/null 2>&1 || true
echo "  arcanium-postgres and its volume are gone."

echo "[pg-recovery] step 4/10: recreating PostgreSQL from scratch"
./scripts/compose.sh infra up -d postgres >/dev/null 2>&1
for i in $(seq 1 30); do
  status=$(podman inspect arcanium-postgres --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
  [ "$status" = healthy ] && break
  sleep 2
done
if [ "$status" != healthy ]; then
  COMPLETED=$(date +%s)
  DETAIL='{"error":"recreated arcanium-postgres never became healthy"}'
  record_result "$STARTED" "$COMPLETED" "$((COMPLETED - STARTED))" 0 false "$DETAIL"
  echo "[pg-recovery] FAILED: $DETAIL" >&2
  echo "== Result: failed =="
  exit 1
fi
echo "  fresh, empty arcanium-postgres is healthy"

echo "[pg-recovery] step 5/10: restoring from the pg_dump taken in step 2"
if ! podman exec -i arcanium-postgres psql -U arcanium -d arcanium_db -v ON_ERROR_STOP=1 <"$DUMP_FILE" >"$DUMP_DIR/restore.log" 2>&1; then
  COMPLETED=$(date +%s)
  DETAIL='{"error":"psql restore failed — see restore.log"}'
  record_result "$STARTED" "$COMPLETED" "$((COMPLETED - STARTED))" 0 false "$DETAIL"
  echo "[pg-recovery] FAILED: $DETAIL (see $DUMP_DIR/restore.log)" >&2
  echo "== Result: failed =="
  exit 1
fi
echo "  restore applied cleanly (see $DUMP_DIR/restore.log)"

echo "[pg-recovery] step 6/10: running migrations forward (restarting arcanium-api/-worker)"
# The dump already contains schema_migrations up to whatever was applied
# before destruction — restarting the app processes makes migrations.js
# actually run against the restored database (a genuine, live re-check,
# not assumed from the dump's own contents) and gives them fresh DB pools,
# since their old connections died with the container they were pointed at.
podman restart arcanium-api >/dev/null 2>&1 || true
podman restart arcanium-worker >/dev/null 2>&1 || true
for i in $(seq 1 30); do
  api_status=$(podman inspect arcanium-api --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
  [ "$api_status" = healthy ] && break
  sleep 2
done
schema_expected=$(ls arcanium/api/src/migrations/ 2>/dev/null | sort | tail -1)
schema_actual=$(podman exec -i arcanium-postgres psql -U arcanium -d arcanium_db -t -A -c \
  "select filename from schema_migrations order by filename desc limit 1;" 2>/dev/null | tr -d '[:space:]')
echo "  arcanium-api health: $api_status"
echo "  schema expected (latest migration file): $schema_expected"
echo "  schema actual (schema_migrations):        $schema_actual"
SCHEMA_OK=false
[ "$schema_actual" = "$schema_expected" ] && SCHEMA_OK=true

echo "[pg-recovery] step 7/10: verifying application state"
AFTER=$(snapshot)
echo "$AFTER" >"$DUMP_DIR/after.json"
STATE_OK=false
if [ "$BEFORE" = "$AFTER" ]; then
  STATE_OK=true
  echo "  before/after snapshot: IDENTICAL"
else
  echo "  before/after snapshot: DIFFERS — see $DUMP_DIR/before.json vs $DUMP_DIR/after.json" >&2
fi

echo "[pg-recovery] step 8/10: measuring RTO/RPO"
COMPLETED=$(date +%s)
RTO=$((COMPLETED - STARTED))
RPO=$((STARTED - RPO_BASELINE))
[ "$RPO" -ge 0 ] || RPO=0
echo "  RTO (destroy -> verified healthy): ${RTO}s"
echo "  RPO (age of last write the dump contains): ${RPO}s"

echo "[pg-recovery] step 9/10: recording the result"
if [ "$api_status" = healthy ] && [ "$SCHEMA_OK" = true ] && [ "$STATE_OK" = true ]; then
  RESULT="recovered"
  VERIFIED=true
  DETAIL="{\"schema_version\":\"$schema_actual\",\"state_match\":true,\"known_app\":\"$KNOWN_APP_NAME\"}"
elif [ "$STATE_OK" = true ] || [ "$SCHEMA_OK" = true ]; then
  RESULT="partially recovered"
  VERIFIED=false
  DETAIL="{\"schema_version\":\"$schema_actual\",\"schema_ok\":$SCHEMA_OK,\"state_match\":$STATE_OK,\"api_health\":\"$api_status\",\"known_app\":\"$KNOWN_APP_NAME\"}"
else
  RESULT="failed"
  VERIFIED=false
  DETAIL="{\"schema_version\":\"$schema_actual\",\"schema_ok\":$SCHEMA_OK,\"state_match\":$STATE_OK,\"api_health\":\"$api_status\",\"known_app\":\"$KNOWN_APP_NAME\"}"
fi
record_result "$STARTED" "$COMPLETED" "$RTO" "$RPO" "$VERIFIED" "$DETAIL"

echo
echo "[pg-recovery] step 10/10: report"
echo "== PostgreSQL recovery drill (Drill B) result =="
echo "  result:       $RESULT"
echo "  rto_seconds:  $RTO"
echo "  rpo_seconds:  $RPO"
echo "  detail:       $DETAIL"

[ "$RESULT" = "recovered" ]
