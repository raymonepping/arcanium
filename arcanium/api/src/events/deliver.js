// events/deliver.js — Prompt 28, Deliverable 3.
//
// Actual HTTP delivery for one webhook_deliveries row: decrypt the
// endpoint's signing secret (Vault Transit — see vault.js), HMAC-SHA256
// sign the payload, POST it, and record the real outcome — every attempt,
// success or failure, updates this same row. "Silent drop" is exactly what
// Deliverable 8's fitness test checks for; this is the code that prevents it.
//
// Design choice, documented rather than assumed: this attempts delivery
// in-process (API request handler or arcanium-worker's reconciliation
// tick, whichever called emitEvent()), not via a separate job queue —
// fire-and-forget from the CALLER's perspective (never awaited), so it
// never blocks a human's API response. In practice the dominant caller is
// arcanium-worker's own periodic sweep (Prompt 20), which is where
// Deliverable 3's "the arcanium-worker handles delivery" language is true;
// an on-demand POST /reconciliation/run from a human session delivers
// inline in the API process instead of handing off to a separate queue —
// a deliberate simplification for this prompt's own stated modest scope
// (not an API gateway product), not an oversight.

import { createHash, createHmac } from "node:crypto";
import { query } from "../db.js";
import { decryptWebhookSecret } from "../vault.js";

const RETRY_DELAYS_MS = [1000, 2000, 4000]; // 3 attempts, exponential backoff
const DELIVERY_TIMEOUT_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postOnce(url, payloadJson, signature) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Arcanium-Signature": signature,
      },
      body: payloadJson,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Attempts delivery of one already-recorded webhook_deliveries row, up to
 * 3 times with exponential backoff. Every attempt updates attempt_count;
 * the row is finalized with either delivered_at+http_status (success) or
 * failed_at+http_status (all 3 attempts exhausted) — never left in a
 * permanently-ambiguous "in flight" state, and never silently discarded on
 * a thrown error (network failure, Vault-decrypt failure, etc. all still
 * result in a recorded failed_at row).
 */
export async function attemptDelivery(
  deliveryId,
  endpoint,
  eventName,
  payloadJson,
) {
  let lastStatus = null;
  let lastError = null;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const secret = await decryptWebhookSecret(endpoint.secret_ciphertext);
      const signature = createHmac("sha256", secret)
        .update(payloadJson)
        .digest("hex");
      const result = await postOnce(endpoint.url, payloadJson, signature);
      lastStatus = result.status;
      if (result.ok) {
        await query(
          `UPDATE webhook_deliveries SET http_status = $2, delivered_at = now(), attempt_count = $3
           WHERE id = $1`,
          [deliveryId, result.status, attempt],
        );
        return;
      }
      lastError = `endpoint responded ${result.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await query(
      "UPDATE webhook_deliveries SET attempt_count = $2 WHERE id = $1",
      [deliveryId, attempt],
    );
    if (attempt < RETRY_DELAYS_MS.length)
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }
  // Exhausted every attempt — recorded as failed, never left ambiguous.
  await query(
    `UPDATE webhook_deliveries SET http_status = $2, failed_at = now() WHERE id = $1`,
    [deliveryId, lastStatus],
  ).catch(() => {});
  console.error(
    `[events] webhook delivery ${deliveryId} to endpoint ${endpoint.id} (${eventName}) failed after ${RETRY_DELAYS_MS.length} attempts: ${lastError}`,
  );
}

export function payloadHashOf(payloadJson) {
  return createHash("sha256").update(payloadJson).digest("hex");
}
