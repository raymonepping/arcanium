// events/emit.js — Prompt 28, Deliverable 3.
//
// The one call site every reconciliation-status-change/expiry-approaching
// signal goes through. Never called directly by a route — reconciliation/
// engine.js's recordRun() is the single place that already knows the
// prior-vs-new status transition (Prompt 22's own state-machine validation
// lives there too), so event emission hangs off that same, already-proven
// transition detection rather than re-deriving it.

import { query } from "../db.js";
import { attemptDelivery, payloadHashOf } from "./deliver.js";

export const EVENTS = Object.freeze([
  "reconciliation.drifted",
  "reconciliation.compliant",
  "key.expiry_approaching",
]);

/**
 * Emits `eventName` with `payload` to every enabled webhook_endpoints row
 * subscribed to it. Records one webhook_deliveries row per matching
 * endpoint BEFORE attempting delivery (so "we tried" is durable even if
 * the process crashes mid-delivery), then fires delivery asynchronously —
 * never awaited by the caller (recordRun() must not block a reconciliation
 * sweep on a third party's HTTP endpoint).
 */
export async function emitEvent(eventName, payload) {
  if (!EVENTS.includes(eventName)) {
    console.error(
      `[events] emitEvent called with unknown event "${eventName}" — ignored`,
    );
    return;
  }
  let endpoints;
  try {
    ({ rows: endpoints } = await query(
      "SELECT id, url, secret_ciphertext FROM webhook_endpoints WHERE enabled = true AND $1 = ANY(events)",
      [eventName],
    ));
  } catch (err) {
    console.error(
      `[events] could not look up webhook_endpoints for "${eventName}": ${err.message}`,
    );
    return;
  }
  if (!endpoints.length) return; // no subscribers — not an error, not a drop

  const payloadJson = JSON.stringify(payload);
  const payloadHash = payloadHashOf(payloadJson);

  for (const endpoint of endpoints) {
    try {
      const { rows } = await query(
        `INSERT INTO webhook_deliveries (endpoint_id, event, payload_hash, attempt_count)
         VALUES ($1, $2, $3, 0) RETURNING id`,
        [endpoint.id, eventName, payloadHash],
      );
      const deliveryId = rows[0].id;
      // Deliberately not awaited — see this module's own header comment.
      attemptDelivery(deliveryId, endpoint, eventName, payloadJson).catch(
        (err) => {
          console.error(
            `[events] delivery ${deliveryId} threw unexpectedly: ${err.message}`,
          );
        },
      );
    } catch (err) {
      console.error(
        `[events] could not record a delivery attempt for endpoint ${endpoint.id} (${eventName}): ${err.message}`,
      );
    }
  }
}
