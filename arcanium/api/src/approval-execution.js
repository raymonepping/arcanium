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

import { query, withTransaction } from "./db.js";
import {
  vaultRequest,
  vaultRequestNs,
  getProvisionerToken,
  getTransitKey,
  getNamespaceTransitKey,
} from "./vault.js";
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
//
// Prompt 36 — now takes appId (the approval's own, now-correctly-attached
// owning application — see provisioner/key.js's requestKeyDestroy())
// instead of keyName alone. Previously both branches matched by key_name
// across the WHOLE estate: a DIFFERENT tenant's own same-named key being
// DRIFTED, or a different tenant's application mid-offboarding, could
// authorize destroying THIS approval's key. Scoping both branches to the
// approval's own application closes that; the offboarding branch no
// longer needs a crypto_profiles join at all — it can check the
// application's own offboarding status directly by id.
async function hasLiveDestroyIntent(keyName, appId) {
  const { rows: dsRows } = await query(
    `SELECT ds.id, lr.status
       FROM desired_state ds
       LEFT JOIN LATERAL (
         SELECT status FROM reconciliation_runs r
          WHERE r.desired_state_id = ds.id
          ORDER BY r.observed_at DESC LIMIT 1
       ) lr ON true
      WHERE ds.application_id = $1 AND ds.key_name = $2
        AND ds.requirement = 'expiry_date' AND ds.archived_at IS NULL`,
    [appId, keyName],
  );
  for (const ds of dsRows) {
    if (ds.status !== "DRIFTED") continue;
    const disposition = await getDispositionFor(ds.id, ds.status);
    if (disposition === "OPEN") return true; // still actively drifted, no exception in effect
  }

  const { rows: appRows } = await query(
    `SELECT id FROM applications
      WHERE id = $1 AND offboarding_initiated_at IS NOT NULL AND offboarded_at IS NULL`,
    [appId],
  );
  return appRows.length > 0;
}

// Prompt 36 — resolves the Vault path + tenant namespace for a destroy
// request's key, scoped to the approval's own (now-correct) application —
// no longer an estate-wide, unscoped key-name search. Two tenants with a
// same-named key can no longer collide: crypto_profiles is joined through
// THIS ONE application only.
async function resolveKeyLocation(appId, keyName) {
  const { rows } = await query(
    `SELECT cp.vault_path, s.vault_namespace AS namespace
       FROM applications a
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       LEFT JOIN crypto_profiles cp
         ON cp.application_id = a.id AND cp.vault_path LIKE '%/' || $2
      WHERE a.id = $1
      LIMIT 1`,
    [appId, keyName],
  );
  return rows[0] ?? { vault_path: null, namespace: null };
}

// Reads a key's live metadata (never assumed) ahead of a destroy — used
// both to confirm the pinned-version pin (see requestKeyDestroy()'s own
// comment) and, inside destroyTransitKey(), to avoid blindly force-setting
// deletion_allowed. Returns null (not throwing) on a 404 — "key not
// found" is a legitimate, expected outcome here, not an error condition.
async function readLiveKeyMeta(keyName, namespace) {
  try {
    return namespace
      ? await getNamespaceTransitKey(namespace, keyName)
      : await getTransitKey(keyName);
  } catch (err) {
    if (err.vaultStatus === 404) return null;
    throw err;
  }
}

// Prompt 36 — previously unconditionally forced deletion_allowed=true
// before every delete, with no read of the key's actual live protection
// state first, and never restored it if the DELETE that followed then
// failed (Sentinel EGP, Control Group, a transient error) — leaving a
// key that was deliberately delete-protected permanently stripped of that
// protection as a side effect of a failed destroy attempt. Now: reads
// live metadata first; only flips deletion_allowed if it isn't already
// true; restores the prior value if DELETE fails; a DELETE 404 (key
// already gone) is treated as success, not an error, since "the key no
// longer exists" is exactly the end state a destroy is trying to reach.
async function destroyTransitKey(keyName, namespace, liveMeta) {
  const token = getProvisionerToken();
  const configPath = `transit/keys/${keyName}/config`;
  const deletePath = `transit/keys/${keyName}`;
  const req = namespace
    ? (method, path, body) =>
        vaultRequestNs(method, path, body, token, namespace)
    : (method, path, body) => vaultRequest(method, path, body, token);

  const wasAlreadyDeletable = liveMeta?.deletion_allowed === true;
  if (!wasAlreadyDeletable) {
    await req("POST", configPath, { deletion_allowed: true });
  }
  try {
    await req("DELETE", deletePath, null);
  } catch (err) {
    if (err.vaultStatus === 404) return; // already gone — the desired end state
    if (!wasAlreadyDeletable) {
      // Restore the key's prior protection rather than leave it silently
      // stripped just because this attempt failed.
      await req("POST", configPath, { deletion_allowed: false }).catch(
        (restoreErr) => {
          console.error(
            `[approval-execution] failed to restore deletion_allowed=false on '${keyName}' after a failed destroy attempt: ${restoreErr.message} — this key is now delete-unprotected and needs manual review`,
          );
        },
      );
    }
    throw err;
  }
}

/**
 * Executes every approved-but-unexecuted destroy request (action='revoke',
 * status='approved', executed_at IS NULL): destroys the Transit key in
 * Vault, records a lifecycle_events row, and sets executed_at. Left
 * unexecuted (executed_at stays NULL, retried next tick) on any failure —
 * never marked executed just because an attempt was made. Safe to call
 * repeatedly; a request already executed is excluded by the WHERE clause.
 *
 * Prompt 36 — each row is now claimed, checked, destroyed, and marked
 * executed inside ONE real transaction (withTransaction(), FOR UPDATE
 * SKIP LOCKED) instead of a plain SELECT followed by three separate
 * pooled statements. This closes two gaps at once: (a) a real TOCTOU
 * window previously existed between the hasLiveDestroyIntent() check and
 * the actual delete — an Accept-Exception click in that window did not
 * stop an in-flight delete, the exact failure mode this module's own
 * original incident was about, only narrowed to a smaller window before
 * this fix, not closed; (b) no concurrency guard existed on the claim
 * itself (unlike worker.js's own job-claim, immediately below this in the
 * call chain, which already got this right). Holding the row lock across
 * the live Vault call is deliberate and safe — it blocks a second claim of
 * THIS row only, never other rows.
 */
async function claimAndProcessOne(excludeIds) {
  let claimedId = null;
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, key_name, app_id, pinned_key_version FROM approval_requests
          WHERE status = 'approved' AND action = 'revoke' AND executed_at IS NULL
            AND NOT (id = ANY($1::uuid[]))
          ORDER BY updated_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [excludeIds],
      );
      const req = rows[0];
      if (!req) return null;
      claimedId = req.id;

      if (!(await hasLiveDestroyIntent(req.key_name, req.app_id))) {
        console.warn(
          `[approval-execution] SKIPPING '${req.key_name}' (approval ${req.id}): approved, but no active governance trigger found (no current DRIFTED expiry_date row, not mid-offboarding) — left unexecuted for human review, not destroyed`,
        );
        return { id: req.id, key_name: req.key_name, outcome: "skipped" };
      }

      const { namespace } = await resolveKeyLocation(req.app_id, req.key_name);
      const liveMeta = await readLiveKeyMeta(req.key_name, namespace);

      if (!liveMeta) {
        // Already gone — nothing to destroy. Mark executed so this stops
        // being retried, without ever having called delete.
        await client.query(
          "UPDATE approval_requests SET executed_at = now() WHERE id = $1",
          [req.id],
        );
        return { id: req.id, key_name: req.key_name, outcome: "already-gone" };
      }

      // Prompt 36 — the pinned-version check. req.pinned_key_version was
      // captured when this request was RAISED (requestKeyDestroy()); a
      // NULL pin (couldn't be captured then) never authorizes a delete on
      // its own, and a live version that no longer matches means the key
      // has changed (rotated, or destroyed+recreated under the same
      // name) since this request was reviewed — refuse and leave it for
      // re-review rather than destroy a key that is no longer the one
      // approved.
      if (
        req.pinned_key_version == null ||
        liveMeta.latest_version !== req.pinned_key_version
      ) {
        console.warn(
          `[approval-execution] SKIPPING '${req.key_name}' (approval ${req.id}): pinned version ${req.pinned_key_version ?? "unknown"} does not match live version ${liveMeta.latest_version} — the key has changed since this request was raised, left unexecuted for re-review`,
        );
        return {
          id: req.id,
          key_name: req.key_name,
          outcome: "version-mismatch",
        };
      }

      await destroyTransitKey(req.key_name, namespace, liveMeta);
      await client.query(
        "UPDATE approval_requests SET executed_at = now() WHERE id = $1",
        [req.id],
      );
      await client
        .query(
          `INSERT INTO lifecycle_events (resource_type, resource_id, event, detail, source)
           VALUES ('key', $1, 'key.destroyed', $2, 'local')`,
          [req.key_name, JSON.stringify({ approval_id: req.id })],
        )
        .catch(() => {});
      console.log(
        `[approval-execution] destroyed key '${req.key_name}' (approval ${req.id})`,
      );
      return { id: req.id, key_name: req.key_name, outcome: "executed" };
    });
  } catch (err) {
    console.error(
      `[approval-execution] failed to execute approved destroy${claimedId ? ` (approval ${claimedId})` : ""}: ${err.message} — will retry next tick`,
    );
    return { id: claimedId, outcome: "error" };
  }
}

export async function executeApprovedDestroys() {
  let checked = 0;
  let executed = 0;
  let failed = 0;
  let skipped = 0;
  // Prompt 36 — excludeIds guarantees forward progress within one call:
  // a claim that errors (transaction rolled back, executed_at still
  // NULL) would otherwise be immediately re-claimable by the very next
  // loop iteration in this SAME tick, spinning on one failing row
  // forever — precisely the class of "looks like a hang, behaves like
  // one" incident this codebase has already been burned by once
  // (auth.global.ts's own documented history). Each id is attempted at
  // most once per call; a genuinely transient failure gets retried on
  // the NEXT tick, not the next loop iteration.
  const excludeIds = [];
  for (;;) {
    const result = await claimAndProcessOne(excludeIds);
    if (!result) break;
    checked++;
    if (result.id) excludeIds.push(result.id);
    if (result.outcome === "executed" || result.outcome === "already-gone")
      executed++;
    else if (result.outcome === "error") failed++;
    else skipped++;
  }
  return { checked, executed, failed, skipped };
}
