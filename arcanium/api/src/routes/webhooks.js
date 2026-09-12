// routes/webhooks.js — Prompt 28, Deliverable 3: webhook endpoint
// management. Estate-wide only (authorize({action:'provision'})) — same
// weight as creating a service account or a team; this is operator
// configuration, not tenant-facing data.

import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { query } from "../db.js";
import { authorize } from "../auth/authorize.js";
import { encryptWebhookSecret } from "../vault.js";
import { EVENTS } from "../events/emit.js";

export const webhooksRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id) {
  if (!UUID_RE.test(id)) {
    const err = new Error("invalid id format");
    err.status = 400;
    throw err;
  }
}
function notFound() {
  const err = new Error("not found");
  err.status = 404;
  return err;
}

// Never selects secret_hash or secret_ciphertext.
const WEBHOOK_COLUMNS = "id, url, events, enabled, created_by, created_at";

// GET /api/v1/webhooks — estate-wide `read` only.
webhooksRouter.get("/", async (req, res, next) => {
  try {
    const decision = authorize({ identity: req.identity, action: "read" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "read",
        reason: decision.reason,
      });
    const { rows } = await query(
      `SELECT ${WEBHOOK_COLUMNS} FROM webhook_endpoints ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/webhooks/:id/deliveries — Deliverable 3/8: failed deliveries
// surfaced, never silently dropped. ?status=failed narrows to exactly that.
webhooksRouter.get("/:id/deliveries", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "read" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "read",
        reason: decision.reason,
      });
    const params = [req.params.id];
    let where = "endpoint_id = $1";
    if (req.query.status === "failed") {
      where += " AND failed_at IS NOT NULL";
    }
    const { rows } = await query(
      `SELECT id, event, http_status, delivered_at, failed_at, attempt_count
         FROM webhook_deliveries WHERE ${where} ORDER BY id DESC LIMIT 200`,
      params,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/webhooks — estate-wide `provision` only. The signing secret
// is returned in plaintext exactly once, in THIS response — same
// single-issuance discipline as service-account tokens.
webhooksRouter.post("/", async (req, res, next) => {
  try {
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { url, events } = req.body ?? {};
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url))
      return res.status(400).json({
        error: "url is required and must be an http(s) URL",
        field: "url",
      });
    if (
      !Array.isArray(events) ||
      !events.length ||
      events.some((e) => !EVENTS.includes(e))
    )
      return res.status(400).json({
        error: `events must be a non-empty array of: ${EVENTS.join(", ")}`,
        field: "events",
      });

    const secret = randomBytes(32).toString("hex"); // 256 bits
    const secretHash = createHash("sha256")
      .update(secret, "utf8")
      .digest("hex");
    const secretCiphertext = await encryptWebhookSecret(secret);

    const { rows } = await query(
      `INSERT INTO webhook_endpoints (url, events, secret_hash, secret_ciphertext, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${WEBHOOK_COLUMNS}`,
      [
        url,
        events,
        secretHash,
        secretCiphertext,
        req.identity?.user ?? "arcanium",
      ],
    );
    res.status(201).json({
      ...rows[0],
      secret,
      warning:
        "Store this signing secret securely — it will not be shown again",
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/webhooks/:id — estate-wide `provision` only. A hard
// delete: webhook subscriptions are operational configuration, not
// evidence/governance history (unlike desired_state/reconciliation_runs/
// control_assessments, which are never hard-deleted — Deliverable 8's own
// fitness test).
webhooksRouter.delete("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { rowCount } = await query(
      "DELETE FROM webhook_endpoints WHERE id = $1",
      [req.params.id],
    );
    if (!rowCount) return next(notFound());
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
