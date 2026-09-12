// offboarding.js — Prompt 28, Deliverable 6.
//
// A governed workflow with an audit trail, not a cascade delete hidden
// behind an endpoint: initiating offboarding submits real destroy_request
// approvals (the same four-eyes gate every other destruction in this
// codebase goes through — no second, lighter destruction mechanism), and
// nothing is finalized until every one of them is actually resolved.
// desired_state rows are archived (tombstoned), never hard-deleted —
// evidence, reconciliation history, and control_assessments all outlive
// the application's own lifecycle.

import { query } from "./db.js";
import { requestKeyDestroy } from "./provisioner/key.js";
import { observeExpiryDate } from "./reconciliation/observe.js";

// Reuses observeExpiryDate() purely for its "is this Vault key still
// active" observation (a 404 vs. a genuine read) — the expiry-date
// semantics it was built for are irrelevant here; what's reused is the
// underlying "does this key still exist" check, not duplicated.
async function keyIsActive(vaultPath, namespace) {
  if (!vaultPath) return false; // no crypto_profile on record — nothing to destroy
  const observed = await observeExpiryDate(vaultPath, namespace);
  if (observed.status === "OK") return observed.value.active;
  // UNKNOWN (Vault unreachable) — conservatively assume still active;
  // never assume "already destroyed" just because a read failed.
  return true;
}

/**
 * Checks whether every desired_state row for this application is now
 * resolved (archived, or its destroy_request approval is no longer
 * pending) and, if so, tombstones any remaining rows and marks the
 * application offboarded. Safe to call repeatedly/idempotently — this is
 * also what the worker's periodic tick calls for every in-progress
 * offboarding, so approvals resolved through the normal approve/deny
 * routes (routes/approvals.js, untouched by this module) eventually get
 * picked up without those routes needing any offboarding-specific logic.
 */
export async function checkOffboardingCompletion(applicationId) {
  const { rows: appRows } = await query(
    "SELECT offboarding_initiated_at, offboarded_at FROM applications WHERE id = $1",
    [applicationId],
  );
  if (!appRows.length) return null;
  if (!appRows[0].offboarding_initiated_at || appRows[0].offboarded_at)
    return appRows[0];

  const { rows: dsRows } = await query(
    "SELECT id, key_name, archived_at FROM desired_state WHERE application_id = $1",
    [applicationId],
  );

  let allResolved = true;
  for (const ds of dsRows) {
    if (ds.archived_at) continue;
    // Matched by key_name alone, NOT app_id — the same workaround
    // aggregation/intent.js's own governance section already had to apply
    // (see its comment above the `approvals` query): provisioner/key.js's
    // requestKeyDestroy() unconditionally attaches every destroy request's
    // app_id to "the first registered application" (an FK-satisfying
    // placeholder, not the key's real owner), so filtering on app_id here
    // would leave this workflow stuck forever whenever that placeholder
    // isn't this application. key_name alone is safe: `ds` was already
    // selected FROM desired_state WHERE application_id = $1, so it's
    // guaranteed to belong to this application's own key set.
    const { rows: apRows } = await query(
      `SELECT status FROM approval_requests
        WHERE key_name = $1 AND action = 'revoke'
        ORDER BY created_at DESC LIMIT 1`,
      [ds.key_name],
    );
    const latest = apRows[0];
    if (latest && latest.status !== "pending") {
      // Resolved either way (approved -> Vault destroy already happened
      // via the normal approval-execution path; rejected -> the operator
      // decided not to destroy it) — either outcome closes THIS workflow
      // step; the row is tombstoned, not left dangling.
      await query(
        "UPDATE desired_state SET archived_at = now() WHERE id = $1",
        [ds.id],
      );
    } else {
      allResolved = false;
    }
  }

  if (allResolved) {
    await query(
      "UPDATE applications SET offboarded_at = now() WHERE id = $1 AND offboarded_at IS NULL",
      [applicationId],
    );
  }
  const { rows: finalRows } = await query(
    "SELECT offboarding_initiated_at, offboarded_at FROM applications WHERE id = $1",
    [applicationId],
  );
  return finalRows[0];
}

/**
 * Step 1-2 of Deliverable 6's workflow: marks offboarding_initiated_at
 * (idempotent — a second call against an already-initiating application
 * is a no-op on that column, not an error) and, for every still-active key,
 * submits a real destroy_request approval; already-inactive keys are
 * archived immediately (nothing to wait for). Never deletes anything.
 */
export async function initiateOffboarding(applicationId, actor) {
  const { rows } = await query(
    `UPDATE applications
        SET offboarding_initiated_at = COALESCE(offboarding_initiated_at, now())
      WHERE id = $1
      RETURNING offboarding_initiated_at, offboarded_at`,
    [applicationId],
  );
  if (!rows.length) {
    const e = new Error("application not found");
    e.status = 404;
    throw e;
  }
  if (rows[0].offboarded_at) {
    const e = new Error("application is already offboarded");
    e.status = 409;
    throw e;
  }

  const { rows: dsRows } = await query(
    `SELECT ds.id, ds.key_name, ds.archived_at, cp.vault_path, s.vault_namespace AS namespace
       FROM desired_state ds
       JOIN applications a ON a.id = ds.application_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       LEFT JOIN crypto_profiles cp
         ON cp.application_id = ds.application_id AND cp.vault_path LIKE '%/' || ds.key_name
      WHERE ds.application_id = $1 AND ds.archived_at IS NULL`,
    [applicationId],
  );

  const destroyRequestsSubmitted = [];
  for (const ds of dsRows) {
    const active = await keyIsActive(ds.vault_path, ds.namespace);
    if (active) {
      const approval = await requestKeyDestroy(
        ds.key_name,
        actor ?? "arcanium",
      );
      destroyRequestsSubmitted.push({
        desired_state_id: ds.id,
        key_name: ds.key_name,
        approval_id: approval.id,
      });
    } else {
      await query(
        "UPDATE desired_state SET archived_at = now() WHERE id = $1",
        [ds.id],
      );
    }
  }

  const status = await checkOffboardingCompletion(applicationId);
  return { ...status, destroy_requests_submitted: destroyRequestsSubmitted };
}

/**
 * Sweeps every application currently mid-offboarding, checking whether it
 * can now be finalized. Called from the worker's periodic tick (worker.js)
 * — the same "the worker owns background progress" pattern the
 * reconciliation sweep and evidence ingest ticks already use.
 */
export async function sweepOffboarding() {
  const { rows } = await query(
    "SELECT id FROM applications WHERE offboarding_initiated_at IS NOT NULL AND offboarded_at IS NULL",
  );
  let completed = 0;
  for (const app of rows) {
    const status = await checkOffboardingCompletion(app.id);
    if (status?.offboarded_at) completed++;
  }
  return { checked: rows.length, completed };
}
