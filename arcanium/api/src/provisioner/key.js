// provisioner/key.js — Prompt 14.2
// Key lifecycle operations Arcanium runs on an operator's behalf.
//   rotate  — transit/keys/:name/rotate
//   rewrap  — transit/rewrap/:name  (CIPHERTEXT ONLY — the one data-plane call
//             Arcanium is allowed to make; it never sees plaintext)
//   destroy — governance-gated: creates an approval_requests row, returns 202.
//             The key is only deleted after the approval resolves.

import { vaultRequest, getProvisionerToken } from "../vault.js";
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
 */
export async function requestKeyDestroy(name, requester = "arcanium-operator") {
  // Find an application to attach the approval to (schema requires app_id).
  const { rows } = await query(
    "SELECT id FROM applications ORDER BY registered_at LIMIT 1",
  );
  const appId = rows[0]?.id;
  if (!appId) {
    const e = new Error(
      "no application registered to attach the destroy request to",
    );
    e.status = 409;
    throw e;
  }
  const { rows: ap } = await query(
    `INSERT INTO approval_requests (app_id, key_name, action, requester, source)
     VALUES ($1,$2,'revoke',$3,'local')
     RETURNING id, key_name, action, status, created_at`,
    [appId, name, requester],
  );
  await query(
    `INSERT INTO lifecycle_events (resource_type, resource_id, event, detail, source)
     VALUES ('key',$1,'destroy.requested',$2,'local')`,
    [name, JSON.stringify({ approval_id: ap[0].id })],
  ).catch(() => {});
  return ap[0];
}
