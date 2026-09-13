// provisioner/key.js — Prompt 14.2
// Key lifecycle operations Arcanium runs on an operator's behalf.
//   rotate  — transit/keys/:name/rotate
//   rewrap  — transit/rewrap/:name  (CIPHERTEXT ONLY — the one data-plane call
//             Arcanium is allowed to make; it never sees plaintext)
//   destroy — governance-gated: creates an approval_requests row, returns 202.
//             The key is only deleted after the approval resolves.

import {
  vaultRequest,
  getProvisionerToken,
  getTransitKey,
  getNamespaceTransitKey,
} from "../vault.js";
import { query } from "../db.js";
import { runSteps } from "./steps.js";
import { cryptoOp } from "../telemetry/metrics.js";

export async function rotateKey(job, name) {
  return runSteps(job, [
    {
      name: `rotate transit/keys/${name}`,
      run: async () => {
        await vaultRequest(
          "POST",
          `transit/keys/${name}/rotate`,
          {},
          getProvisionerToken(),
        );
        cryptoOp("rotate", name);
        const meta = await vaultRequest(
          "GET",
          `transit/keys/${name}`,
          null,
          getProvisionerToken(),
        );
        return `now at version ${meta?.data?.latest_version}`;
      },
    },
  ]);
}

export async function rewrapCiphertext(name, ciphertext) {
  if (typeof ciphertext !== "string" || !ciphertext.startsWith("vault:")) {
    const e = new Error("ciphertext must be a vault:v*: string");
    e.status = 400;
    throw e;
  }
  const res = await vaultRequest(
    "POST",
    `transit/rewrap/${name}`,
    { ciphertext },
    getProvisionerToken(),
  );
  cryptoOp("rewrap", name);
  await query(
    `INSERT INTO lifecycle_events (resource_type, resource_id, event, source)
     VALUES ('key',$1,'rewrap','local')`,
    [name],
  ).catch(() => {});
  return res?.data?.ciphertext;
}

/**
 * Governance-gated destroy. Does NOT delete the key — records an approval request
 * and returns it. A separate approve step (+ Control Group where the key's
 * namespace policy carries a control_group stanza) performs the actual deletion.
 *
 * Prompt 36 — previously attached every request's app_id to "the first
 * registered application" (an FK-satisfying placeholder, never the key's
 * real owner) — three separate modules (approval-execution.js's
 * hasLiveDestroyIntent(), offboarding.js's approval resolution,
 * aggregation/intent.js's governance view) each had to work around this
 * with the same name-only matching this fix closes at the source. Callers
 * that know their key's real owner (offboarding.js, engine.js's
 * reconcileExpiryDate()) now pass it explicitly via appId; the one caller
 * that doesn't (routes/keys.js's root-namespace key detail page) falls
 * back to a root-namespace-only resolution — safe because that route only
 * ever operates on root-namespace keys, so a same-named supplier-tenant
 * key can never be picked instead — and refuses honestly (409) rather
 * than mis-attaching when no such application exists.
 */
export async function requestKeyDestroy(
  name,
  requester = "arcanium-operator",
  { appId, namespace } = {},
) {
  let resolvedAppId = appId ?? null;
  let resolvedSupplierId = null;

  if (resolvedAppId) {
    const { rows } = await query(
      "SELECT supplier_id FROM applications WHERE id = $1",
      [resolvedAppId],
    );
    resolvedSupplierId = rows[0]?.supplier_id ?? null;
  } else {
    const { rows } = await query(
      `SELECT a.id, a.supplier_id FROM applications a
         JOIN crypto_profiles cp ON cp.application_id = a.id
        WHERE cp.vault_path LIKE '%/' || $1 AND a.supplier_id IS NULL
        ORDER BY cp.created_at ASC LIMIT 1`,
      [name],
    );
    resolvedAppId = rows[0]?.id ?? null;
    resolvedSupplierId = rows[0]?.supplier_id ?? null;
  }
  if (!resolvedAppId) {
    const e = new Error(
      "no registered application owns this key — cannot attribute a destroy request to an application",
    );
    e.status = 409;
    throw e;
  }

  // Prompt 36 — pin the key's live version at request time (read, not
  // asserted). approval-execution.js re-checks this immediately before
  // the actual delete; a mismatch means the key has changed (rotated, or
  // destroyed and recreated under the same name) since this request was
  // raised, and execution refuses rather than destroying a key that is
  // no longer the one reviewed. A read failure here (key already gone,
  // or a transient Vault error) leaves this NULL — approval-execution.js
  // never treats NULL as "matches," so this can never authorize a delete
  // on its own.
  let pinnedKeyVersion = null;
  try {
    const meta = namespace
      ? await getNamespaceTransitKey(namespace, name)
      : await getTransitKey(name);
    pinnedKeyVersion = meta?.latest_version ?? null;
  } catch {
    /* left NULL deliberately — see comment above */
  }

  const { rows: ap } = await query(
    `INSERT INTO approval_requests (app_id, key_name, action, requester, source, supplier_id, pinned_key_version)
     VALUES ($1,$2,'revoke',$3,'local',$4,$5)
     RETURNING id, key_name, action, status, created_at`,
    [resolvedAppId, name, requester, resolvedSupplierId, pinnedKeyVersion],
  );
  await query(
    `INSERT INTO lifecycle_events (resource_type, resource_id, event, detail, source)
     VALUES ('key',$1,'destroy.requested',$2,'local')`,
    [name, JSON.stringify({ approval_id: ap[0].id })],
  ).catch(() => {});
  return ap[0];
}
