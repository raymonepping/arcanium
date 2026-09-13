// approval-execution.js — Prompt 29, Deliverable 6.
//
// Closes a real gap found live: requestKeyDestroy() (provisioner/key.js)
// only ever inserts an approval_requests row, and approving it
// (routes/approvals.js POST /:id/approve) only ever flips its status
// column — nothing anywhere then performed the actual Vault key deletion.
// This module is that missing step: it finds approved-but-unexecuted
// destroy requests and actually destroys the key in Vault, then marks the
// request executed. The four-eyes approval gate itself is untouched — this
// makes an already-approved request take effect, it does not change who
// can approve or how.
//
// Vault Transit key deletion is a two-step operation: the key's own config
// must have deletion_allowed=true set before a DELETE succeeds (Vault
// refuses to delete a key with deletion_allowed unset/false) — done here as
// part of the same execution step, not a prerequisite an operator has to
// remember to set in advance.

import { query } from "./db.js";
import { vaultRequest, vaultRequestNs, getProvisionerToken } from "./vault.js";
import { getDispositionFor } from "./reconciliation/engine.js";

// Prompt 29 — found live, the hard way: the first version of this module
// executed EVERY approved-but-unexecuted revoke request unconditionally.
// Two stale rows from unrelated prior-day testing (payments-api-key,
// ticket-service-key) had sat 'approved' for over a day — harmless before
// this module existed, since nothing had ever acted on 'approved' status.
// The moment this code shipped, both were destroyed on the very first
// worker tick — including payments-api-key, which a CISO had, minutes
// earlier, explicitly used Accept Exception to protect. That action only
// ever changes reconciliation disposition (EXCEPTION_ACCEPTED); it does
// not touch this approval_requests row at all, and nothing here was
// checking disposition before this fix. payments-api's own live workload
// broke immediately (real 403s on every encrypt call) — this was not a
// theoretical risk.
//
// hasLiveDestroyIntent() closes that: a destroy request only executes if
// it still corresponds to an ACTIVE governance trigger at execution time,
// not merely "was approved once" — either a currently-DRIFTED expiry_date
// desired-state row (not EXCEPTION_ACCEPTED, not already reconciled), or
// the key's owning application currently mid-offboarding. An approval that
// matches neither is left unexecuted and logged for human review, never
// silently acted on and never silently dropped either.
async function hasLiveDestroyIntent(keyName) {
  const { rows: dsRows } = await query(
    `SELECT ds.id, lr.status
       FROM desired_state ds
       LEFT JOIN LATERAL (
         SELECT status FROM reconciliation_runs r
          WHERE r.desired_state_id = ds.id
          ORDER BY r.observed_at DESC LIMIT 1
       ) lr ON true
      WHERE ds.key_name = $1 AND ds.requirement = 'expiry_date' AND ds.archived_at IS NULL`,
    [keyName],
  );
  for (const ds of dsRows) {
    if (ds.status !== "DRIFTED") continue;
    const disposition = await getDispositionFor(ds.id, ds.status);
    if (disposition === "OPEN") return true; // still actively drifted, no exception in effect
  }

  const { rows: appRows } = await query(
    `SELECT a.id FROM applications a
       JOIN crypto_profiles cp ON cp.application_id = a.id
      WHERE cp.vault_path LIKE '%/' || $1
        AND a.offboarding_initiated_at IS NOT NULL
        AND a.offboarded_at IS NULL`,
    [keyName],
  );
  return appRows.length > 0;
}

// Resolves the Vault path + tenant namespace for a bare key_name — the same
// LIKE-based lookup offboarding.js already uses, and for the same reason:
// requestKeyDestroy() attaches every destroy request's app_id to "the first
// registered application" as an FK-satisfying placeholder, never the key's
// real owner, so joining through app_id here would resolve the wrong (or
// no) tenant. key_name is the only reliably correct identifier on this row.
async function resolveKeyLocation(keyName) {
  const { rows } = await query(
    `SELECT cp.vault_path, s.vault_namespace AS namespace
       FROM crypto_profiles cp
       LEFT JOIN applications a ON a.id = cp.application_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
      WHERE cp.vault_path LIKE '%/' || $1
      LIMIT 1`,
    [keyName],
  );
  return rows[0] ?? { vault_path: null, namespace: null };
}

async function destroyTransitKey(keyName, namespace) {
  const token = getProvisionerToken();
  const configPath = `transit/keys/${keyName}/config`;
  const deletePath = `transit/keys/${keyName}`;
  if (namespace) {
    await vaultRequestNs(
      "POST",
      configPath,
      { deletion_allowed: true },
      token,
      namespace,
    );
    await vaultRequestNs("DELETE", deletePath, null, token, namespace);
  } else {
    await vaultRequest("POST", configPath, { deletion_allowed: true }, token);
    await vaultRequest("DELETE", deletePath, null, token);
  }
}

/**
 * Executes every approved-but-unexecuted destroy request (action='revoke',
 * status='approved', executed_at IS NULL): destroys the Transit key in
 * Vault, records a lifecycle_events row, and sets executed_at. Left
 * unexecuted (executed_at stays NULL, retried next tick) on any failure —
 * never marked executed just because an attempt was made. Safe to call
 * repeatedly; a request already executed is excluded by the WHERE clause.
 */
export async function executeApprovedDestroys() {
  const { rows } = await query(
    `SELECT id, key_name FROM approval_requests
      WHERE status = 'approved' AND action = 'revoke' AND executed_at IS NULL
      ORDER BY updated_at ASC`,
  );

  let executed = 0;
  let failed = 0;
  let skipped = 0;
  for (const req of rows) {
    try {
      if (!(await hasLiveDestroyIntent(req.key_name))) {
        skipped++;
        console.warn(
          `[approval-execution] SKIPPING '${req.key_name}' (approval ${req.id}): approved, but no active governance trigger found (no current DRIFTED expiry_date row, not mid-offboarding) — left unexecuted for human review, not destroyed`,
        );
        continue;
      }
      const { namespace } = await resolveKeyLocation(req.key_name);
      await destroyTransitKey(req.key_name, namespace);
      await query(
        "UPDATE approval_requests SET executed_at = now() WHERE id = $1",
        [req.id],
      );
      await query(
        `INSERT INTO lifecycle_events (resource_type, resource_id, event, detail, source)
         VALUES ('key', $1, 'key.destroyed', $2, 'local')`,
        [req.key_name, JSON.stringify({ approval_id: req.id })],
      ).catch(() => {});
      executed++;
      console.log(
        `[approval-execution] destroyed key '${req.key_name}' (approval ${req.id})`,
      );
    } catch (err) {
      failed++;
      console.error(
        `[approval-execution] failed to execute approved destroy of '${req.key_name}' (approval ${req.id}): ${err.message} — will retry`,
      );
    }
  }
  return { checked: rows.length, executed, failed, skipped };
}
