// routes/approvals.js — Approval request management with Vault Control Group integration.
//
// approval_requests schema (from 002_approvals.sql + 004_control_group_accessor.sql):
//   id UUID PK, app_id UUID FK→applications, key_name TEXT, action TEXT,
//   status TEXT ('pending'|'approved'|'rejected'), requester TEXT,
//   approver TEXT, reason TEXT, accessor TEXT UNIQUE,
//   created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ

import { Router } from "express";
import { query } from "../db.js";
import { tenantScope } from "../auth/index.js";
import { authorize } from "../auth/authorize.js";

export const approvalsRouter = Router();

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

// GET /api/v1/approvals
// Returns all pending approvals (status = 'pending') by default.
// Query param ?all=true returns all approvals regardless of status.
approvalsRouter.get("/", async (req, res, next) => {
  try {
    const all = req.query.all === "true";
    const scope = await tenantScope(req);
    const cols = `id, app_id, key_name, action, status, requester, approver,
                  reason, accessor, source, supplier_id, created_at, updated_at`;
    const where = all ? "" : "status = 'pending'";
    const parts = [];
    const params = [];
    if (where) parts.push(where);
    if (scope.scoped) {
      params.push(scope.supplierIds);
      parts.push(
        `(supplier_id = ANY($${params.length}) OR app_id IN (SELECT id FROM applications WHERE supplier_id = ANY($${params.length})))`,
      );
    }
    const clause = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
    const order = all ? "created_at DESC" : "created_at ASC";
    const { rows } = await query(
      `SELECT ${cols} FROM approval_requests ${clause} ORDER BY ${order}`,
      params,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/approvals
// Register a new approval request.
// Body: { app_id, key_name, action, requester, accessor?, reason?, source?, supplier_id? }
approvalsRouter.post("/", async (req, res, next) => {
  try {
    const {
      app_id,
      key_name,
      action,
      requester,
      accessor,
      reason,
      source,
      supplier_id,
    } = req.body ?? {};

    if (!app_id || !UUID_RE.test(app_id))
      return res
        .status(400)
        .json({ error: "app_id is required (UUID)", field: "app_id" });
    if (!key_name)
      return res
        .status(400)
        .json({ error: "key_name is required", field: "key_name" });
    if (!action)
      return res
        .status(400)
        .json({ error: "action is required", field: "action" });
    if (!requester)
      return res
        .status(400)
        .json({ error: "requester is required", field: "requester" });

    const { rows } = await query(
      `INSERT INTO approval_requests
         (app_id, key_name, action, requester, accessor, reason, source, supplier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, app_id, key_name, action, status, requester, accessor, reason, source, supplier_id, created_at`,
      [
        app_id,
        key_name,
        action,
        requester,
        accessor ?? null,
        reason ?? null,
        source ?? "external",
        supplier_id && UUID_RE.test(supplier_id) ? supplier_id : null,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23503")
      return res.status(404).json({ error: "app_id not found" });
    if (err.code === "23505")
      return res.status(409).json({ error: "accessor already registered" });
    next(err);
  }
});

// POST /api/v1/approvals/:id/approve
// Approve: call Vault sys/control-group/authorize with the stored accessor,
// then update status to 'approved'. Uses Arcanium API's own token (POC shortcut).
approvalsRouter.post("/:id/approve", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "approve" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "approve",
        reason: decision.reason,
      });

    // Fetch the pending approval
    const { rows } = await query(
      `SELECT id, status, accessor FROM approval_requests WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) return next(notFound());

    const record = rows[0];
    if (record.status !== "pending")
      return res
        .status(409)
        .json({ error: "approval is not pending", status: record.status });

    // The Vault Control Group authorize call must be made by a token whose identity
    // is a member of the approver group (crypto-approvers). The arcanium-api token
    // is not a member of that group — the approve.sh script handles the Vault CG
    // authorize call directly using approver-1 credentials before calling this endpoint.
    // This endpoint only records the approval in the database.

    // Update approval record
    const { rows: updated } = await query(
      `UPDATE approval_requests
       SET status = 'approved', approver = 'arcanium-api', updated_at = now()
       WHERE id = $1
       RETURNING id, app_id, key_name, action, status, approver, accessor, updated_at`,
      [req.params.id],
    );
    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/approvals/:id/deny
// Deny: record rejection without calling Vault.
approvalsRouter.post("/:id/deny", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "approve" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "approve",
        reason: decision.reason,
      });
    const { reason } = req.body ?? {};

    const { rows } = await query(
      `SELECT id, status FROM approval_requests WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) return next(notFound());
    if (rows[0].status !== "pending")
      return res
        .status(409)
        .json({ error: "approval is not pending", status: rows[0].status });

    const { rows: updated } = await query(
      `UPDATE approval_requests
       SET status = 'rejected', approver = 'arcanium-api', reason = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, app_id, key_name, action, status, approver, reason, updated_at`,
      [req.params.id, reason ?? null],
    );
    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/approvals/:accessor/authorize
// CLI alias — looks up the pending record by accessor and approves it.
// The CLI sends the Vault CG accessor (not the UUID), source=manual.
approvalsRouter.post("/:accessor/authorize", async (req, res, next) => {
  try {
    const { source } = req.body ?? {};
    const { rows } = await query(
      `SELECT id, status FROM approval_requests WHERE accessor = $1`,
      [req.params.accessor],
    );
    if (!rows.length) return next(notFound());
    const record = rows[0];
    if (record.status !== "pending")
      return res
        .status(409)
        .json({ error: "approval is not pending", status: record.status });

    const approver = source === "manual" ? "cli-operator" : "arcanium-api";
    const { rows: updated } = await query(
      `UPDATE approval_requests
       SET status = 'approved', approver = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, app_id, key_name, action, status, approver, accessor, updated_at`,
      [record.id, approver],
    );
    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});
