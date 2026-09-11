// reconciliation/engine.js — Prompt 20.
//
// Orchestrates observe → compare → persist (runSweep), and the two
// governed write-actions (reconcileRun / acceptException). Authorization
// itself is NOT decided here — routes/reconciliation.js calls authorize()
// the same way every other route in this codebase does; this module is
// pure business logic so it's reusable from both the API route and the
// worker's periodic tick.

import { query } from "../db.js";
import { observeRotationPeriod, applyRotationPeriod } from "./observe.js";
import { compare } from "./diff.js";
import {
  OBSERVATION_STATUS_STATES,
  DISPOSITION_STATES,
  assertTransition,
} from "../domain/state-machines.js";

// Only 'rotation_period' exists this phase (Non-goal: widening the
// requirement catalogue is a follow-on, not blocking this phase's exit
// criterion) — but keyed by requirement so adding a second type later is a
// one-line registration, not a rewrite.
const OBSERVERS = {
  rotation_period: (row) =>
    observeRotationPeriod(row.vault_path, row.namespace),
};
const APPLIERS = {
  rotation_period: (row) =>
    applyRotationPeriod(row.vault_path, row.desired_value?.days, row.namespace),
};

async function desiredStateRowsFor({ desiredStateId, supplierIds } = {}) {
  const params = [];
  let where = "";
  if (desiredStateId) {
    params.push(desiredStateId);
    where = `WHERE ds.id = $${params.length}`;
  } else if (supplierIds) {
    params.push(supplierIds);
    where = `WHERE a.supplier_id = ANY($${params.length})`;
  }
  const { rows } = await query(
    `SELECT ds.id, ds.application_id, ds.key_name, ds.requirement, ds.desired_value, ds.version,
            a.supplier_id, s.vault_namespace AS namespace, cp.vault_path
       FROM desired_state ds
       JOIN applications a ON a.id = ds.application_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       LEFT JOIN crypto_profiles cp
         ON cp.application_id = ds.application_id AND cp.type = 'transit'
       ${where}
      ORDER BY ds.application_id, ds.key_name`,
    params,
  );
  return rows;
}

async function recordRun(row, observed, result) {
  // Prompt 22, Deliverable 3 — validate the observation_status transition
  // against the run immediately prior for this same desired_state_id (each
  // run is a fresh INSERT, never an UPDATE of one row, so the "transition"
  // is across successive runs, not within a single row). A same-status
  // run (by far the common case — nothing changed since last tick) is not
  // a transition at all and is always allowed without consulting the
  // machine, matching the same convention provisioner/steps.js's
  // setStatus() uses.
  const { rows: priorRows } = await query(
    `SELECT status FROM reconciliation_runs
      WHERE desired_state_id = $1
      ORDER BY observed_at DESC LIMIT 1`,
    [row.id],
  );
  const priorStatus = priorRows[0]?.status ?? null;
  if (priorStatus && priorStatus !== result.status) {
    assertTransition(OBSERVATION_STATUS_STATES, priorStatus, result.status);
  }

  const { rows } = await query(
    `INSERT INTO reconciliation_runs
       (desired_state_id, desired_state_version, observed_value, status, detail)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, desired_state_id, desired_state_version, observed_value, status, observed_at, detail`,
    [
      row.id,
      row.version,
      observed.value ?? null,
      result.status,
      result.detail ?? null,
    ],
  );
  return {
    ...rows[0],
    application_id: row.application_id,
    key_name: row.key_name,
    requirement: row.requirement,
    desired_value: row.desired_value,
  };
}

/**
 * Runs observe→compare→persist for every matching desired_state row.
 * `desiredStateId` runs exactly one; `supplierIds` scopes to those tenants
 * (a supplier-admin's on-demand run must never observe another tenant's
 * applications); neither scopes to the whole estate — used by the worker's
 * periodic sweep.
 */
export async function runSweep(opts = {}) {
  const rows = await desiredStateRowsFor(opts);
  const results = [];
  for (const row of rows) {
    const observer = OBSERVERS[row.requirement];
    const observed = observer
      ? await observer(row)
      : {
          value: null,
          status: "UNKNOWN",
          detail: `no observer registered for requirement '${row.requirement}'`,
          observed_at: new Date().toISOString(),
        };
    const result = compare(row, observed);
    results.push(await recordRun(row, observed, result));
  }
  return results;
}

/** Most recent action recorded against ANY run of this desired_state — an
 * exception granted against an earlier DRIFTED run still applies to a later
 * run of the same underlying policy drift, not just the one run it was
 * recorded against. */
async function latestAction(desiredStateId) {
  const { rows } = await query(
    `SELECT ra.* FROM reconciliation_actions ra
       JOIN reconciliation_runs rr ON rr.id = ra.run_id
      WHERE rr.desired_state_id = $1
      ORDER BY ra.created_at DESC LIMIT 1`,
    [desiredStateId],
  );
  return rows[0] ?? null;
}

/**
 * Two independent axes (input/36): disposition never changes what was
 * actually observed — only how Arcanium treats that observation. Derived
 * live from reconciliation_actions on every call (not cached/stored) so an
 * expired accept-exception reverts to OPEN the instant it's asked about,
 * not only on the next worker tick — a stronger reading of "must not become
 * permanent by omission" than a periodic-only check would give.
 */
export function computeDisposition(action, latestStatus) {
  if (!action || action.result !== "applied") return "OPEN";
  if (action.action === "accept_exception") {
    const stillValid =
      !action.expires_at || new Date(action.expires_at) > new Date();
    return stillValid ? "EXCEPTION_ACCEPTED" : "OPEN";
  }
  if (action.action === "reconcile" && latestStatus === "COMPLIANT") {
    return "RECONCILED";
  }
  return "OPEN";
}

export async function getDispositionFor(desiredStateId, latestStatus) {
  const action = await latestAction(desiredStateId);
  return computeDisposition(action, latestStatus);
}

/**
 * Reconcile: writes the desired value back to Vault, re-observes to confirm,
 * records a reconciliation_actions row against the run that triggered it.
 * Requires the run currently be DRIFTED — there is nothing to correct
 * otherwise (a caller correcting an already-COMPLIANT or UNKNOWN run is a
 * client error, not a no-op success).
 */
export async function reconcileRun(runId, { actor, actorGroups }) {
  const { rows: runRows } = await query(
    `SELECT rr.*, ds.application_id, ds.key_name, ds.requirement, ds.desired_value, ds.version,
            a.supplier_id, s.vault_namespace AS namespace, cp.vault_path
       FROM reconciliation_runs rr
       JOIN desired_state ds ON ds.id = rr.desired_state_id
       JOIN applications a ON a.id = ds.application_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       LEFT JOIN crypto_profiles cp
         ON cp.application_id = ds.application_id AND cp.type = 'transit'
      WHERE rr.id = $1`,
    [runId],
  );
  if (!runRows.length) {
    const e = new Error("reconciliation run not found");
    e.status = 404;
    throw e;
  }
  const run = runRows[0];
  if (run.status !== "DRIFTED") {
    const e = new Error(
      `run is ${run.status}, not DRIFTED — nothing to reconcile`,
    );
    e.status = 409;
    throw e;
  }

  // `run.id` above is the RUN's own primary key (from `rr.*`), not the
  // desired_state row's id — recordRun()/OBSERVERS/APPLIERS all key off the
  // desired_state row (same shape desiredStateRowsFor() produces for
  // runSweep), so build that shape explicitly rather than relying on which
  // of rr.id / ds.id a bare `rr.*, ds.*` spread happens to keep. Found live:
  // reusing `run` directly here inserted the RUN's id as
  // reconciliation_runs.desired_state_id and failed its FK constraint.
  const desiredStateRow = {
    id: run.desired_state_id,
    application_id: run.application_id,
    key_name: run.key_name,
    requirement: run.requirement,
    desired_value: run.desired_value,
    version: run.version,
    namespace: run.namespace,
    vault_path: run.vault_path,
  };

  const applier = APPLIERS[run.requirement];
  let result = "applied";
  let detail = null;
  let confirmationRun = null;
  try {
    if (!applier)
      throw new Error(
        `no applier registered for requirement '${run.requirement}'`,
      );
    // Prompt 22, Deliverable 3 — a successful reconcile is the one real
    // write site where disposition moves to RECONCILED; validate that
    // transition against whatever disposition this desired_state is
    // currently in (derived, not stored — see getDispositionFor's own
    // comment) BEFORE applying anything to Vault, so an illegal transition
    // is rejected up front rather than discovered after a Vault write.
    const currentDisposition = await getDispositionFor(
      run.desired_state_id,
      run.status,
    );
    if (currentDisposition !== "RECONCILED") {
      assertTransition(DISPOSITION_STATES, currentDisposition, "RECONCILED");
    }
    await applier(desiredStateRow);
    const observed = await OBSERVERS[run.requirement](desiredStateRow);
    const compared = compare(desiredStateRow, observed);
    confirmationRun = await recordRun(desiredStateRow, observed, compared);
    if (compared.status !== "COMPLIANT") {
      result = "failed";
      detail = `re-observed as ${compared.status} after writing desired value`;
    }
  } catch (err) {
    result = "failed";
    detail = err.message;
  }

  const { rows: actionRows } = await query(
    `INSERT INTO reconciliation_actions (run_id, action, actor, actor_groups, result, reason)
     VALUES ($1,'reconcile',$2,$3,$4,$5)
     RETURNING *`,
    [runId, actor, actorGroups ?? [], result, detail],
  );
  return { action: actionRows[0], confirmation_run: confirmationRun };
}

/**
 * Accept-exception: records the exception only — does NOT touch Vault.
 * `reason` and `expires_at` are both required (input/36 — no open-ended
 * exceptions). Only meaningful against a currently-DRIFTED run.
 */
export async function acceptException(
  runId,
  { actor, actorGroups, reason, expiresAt },
) {
  if (!reason || !expiresAt) {
    const e = new Error("reason and expires_at are both required");
    e.status = 400;
    throw e;
  }
  const { rows: runRows } = await query(
    "SELECT id, desired_state_id, status FROM reconciliation_runs WHERE id = $1",
    [runId],
  );
  if (!runRows.length) {
    const e = new Error("reconciliation run not found");
    e.status = 404;
    throw e;
  }
  if (runRows[0].status !== "DRIFTED") {
    const e = new Error(
      `run is ${runRows[0].status}, not DRIFTED — nothing to except`,
    );
    e.status = 409;
    throw e;
  }
  // Prompt 22, Deliverable 3 — validate the disposition transition before
  // recording anything. A CISO re-accepting/extending an already-accepted
  // exception on the same still-DRIFTED run (EXCEPTION_ACCEPTED ->
  // EXCEPTION_ACCEPTED) is a legitimate, currently-supported no-op, not an
  // illegal transition — DISPOSITION_STATES has no self-loops (matching
  // JOB_STATES' convention), so only check when it's actually changing.
  const currentDisposition = await getDispositionFor(
    runRows[0].desired_state_id,
    runRows[0].status,
  );
  if (currentDisposition !== "EXCEPTION_ACCEPTED") {
    assertTransition(
      DISPOSITION_STATES,
      currentDisposition,
      "EXCEPTION_ACCEPTED",
    );
  }
  const { rows } = await query(
    `INSERT INTO reconciliation_actions (run_id, action, actor, actor_groups, result, reason, expires_at)
     VALUES ($1,'accept_exception',$2,$3,'applied',$4,$5)
     RETURNING *`,
    [runId, actor, actorGroups ?? [], reason, expiresAt],
  );
  return rows[0];
}

/** Resolves the tenant namespace + supplier id behind a reconciliation run —
 * used by the route layer for tenantScope's 404 check and authorize()'s
 * `tenant` param, the same two-step pattern every Phase 18+ route uses. */
export async function runTenant(runId) {
  const { rows } = await query(
    `SELECT a.supplier_id, s.vault_namespace
       FROM reconciliation_runs rr
       JOIN desired_state ds ON ds.id = rr.desired_state_id
       JOIN applications a ON a.id = ds.application_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
      WHERE rr.id = $1`,
    [runId],
  );
  return rows[0] ?? null;
}
