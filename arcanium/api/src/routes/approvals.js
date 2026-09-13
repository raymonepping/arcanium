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
import { approvalEvent } from "../telemetry/metrics.js";
import { checkControlGroupRequest } from "../vault.js";
import { resolveKeyLocation, readLiveKeyMeta } from "../approval-execution.js";

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

// Prompt 19 — POST /approvals (create) had no authorization check at all.
// The request body's free-text `action` field (e.g. "revoke", "rotate" —
// see requestKeyDestroy in provisioner/key.js) doesn't map 1:1 onto
// authorize()'s ACTIONS; map the ones that do, and conservatively default
// everything else (including "revoke"/"destroy"/anything unrecognized) to
// destroy_request — the heaviest-weight action this endpoint can gate —
// per the prompt's own instruction, logging a warning when we guess.
const KNOWN_ACTION_MAP = { rotate: "rotate", rewrap: "rewrap", read: "read" };
function resolveApprovalAction(bodyAction) {
  const mapped = KNOWN_ACTION_MAP[String(bodyAction ?? "").toLowerCase()];
  if (mapped) return mapped;
  if (bodyAction) {
    console.warn(
      `[approvals] POST / — unrecognized approval action "${bodyAction}", defaulting authorize() check to destroy_request`,
    );
  }
  return "destroy_request";
}

// Resolves both the tenant namespace (for authorize()'s "limited" verdict)
// and the supplier id (for tenantScope's cross-tenant check): prefer an
// explicit supplier_id on the body, else fall back to the referenced
// application's supplier — so a request that only names app_id still gets
// the tenant boundary enforced, not just requests that also pass supplier_id.
async function approvalTenant({ supplier_id, app_id }) {
  if (supplier_id && UUID_RE.test(supplier_id)) {
    const { rows } = await query(
      "SELECT id, vault_namespace FROM suppliers WHERE id = $1",
      [supplier_id],
    );
    // Prompt 27 — a supplier-only-scoped approval (no app_id) has no single
    // application to read an environment tag from; environment stays null,
    // same as any other estate-level resource this prompt doesn't tag.
    return {
      supplierId: rows[0]?.id ?? null,
      vaultNamespace: rows[0]?.vault_namespace ?? null,
      environment: null,
    };
  }
  if (app_id && UUID_RE.test(app_id)) {
    const { rows } = await query(
      `SELECT s.id, s.vault_namespace, a.environment
         FROM applications a JOIN suppliers s ON s.id = a.supplier_id
        WHERE a.id = $1`,
      [app_id],
    );
    return {
      supplierId: rows[0]?.id ?? null,
      vaultNamespace: rows[0]?.vault_namespace ?? null,
      environment: rows[0]?.environment ?? null,
    };
  }
  return { supplierId: null, vaultNamespace: null, environment: null };
}

// Prompt 27, Deliverable 3 — same env/tenant resolution as approvalTenant()
// above, but keyed by an EXISTING approval_requests row (approve/deny act on
// an id, not a fresh app_id/supplier_id pair from the request body).
async function approvalContext(id) {
  const { rows } = await query(
    `SELECT ar.supplier_id AS ar_supplier_id, a.environment,
            COALESCE(s.vault_namespace, s2.vault_namespace) AS vault_namespace
       FROM approval_requests ar
       LEFT JOIN applications a ON a.id = ar.app_id
       LEFT JOIN suppliers s ON s.id = ar.supplier_id
       LEFT JOIN suppliers s2 ON s2.id = a.supplier_id
      WHERE ar.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  return {
    vaultNamespace: rows[0].vault_namespace ?? null,
    environment: rows[0].environment ?? null,
  };
}

// Prompt 39 — shared gate for both approve routes (POST /:id/approve and
// POST /:accessor/authorize). Two live checks, neither previously made:
//
//  1. Control Group verification. Both routes used to flip status to
//     'approved' purely on the caller's say-so — approve.sh's real flow
//     calls Vault's own sys/control-group/authorize itself (using
//     approver-1's identity) BEFORE calling either of these endpoints, but
//     nothing stopped a caller from skipping that step and hitting these
//     directly, recording a real Vault CG accessor as "approved" when
//     Vault itself never authorized it. checkControlGroupRequest() is a
//     live, side-effect-free status read (verified against a genuine CG
//     request) — approval is refused (never silently allowed) unless
//     Vault itself reports approved:true. When it does, Vault's own
//     response names the real authorizing entity — recorded as the
//     approver instead of a hardcoded "arcanium-api" string.
//  2. The request→approval drift window. Prompt 36 pinned
//     pinned_key_version at REQUEST time and re-verifies it immediately
//     before EXECUTION — but nothing re-confirmed the pin was still
//     current at the moment of APPROVAL itself. A key rotated between
//     request and approval previously went unnoticed until execution's
//     own (already-correct) refusal; this surfaces the same drift at the
//     human decision point instead, for a destroy_request whose live
//     version has already moved past what was pinned.
async function verifyApprovalGate(record) {
  let approver = null;

  if (record.accessor) {
    const cg = await checkControlGroupRequest(record.accessor);
    if (!cg.approved) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "vault control group not authorized",
          detail:
            cg.error ??
            "no approver has authorized this Control Group request in Vault yet — call sys/control-group/authorize as a crypto-approvers member first",
        },
      };
    }
    approver = cg.authorizations?.[0]?.entity_name ?? null;
  }

  if (record.action === "revoke" && record.app_id && record.key_name) {
    const { namespace } = await resolveKeyLocation(
      record.app_id,
      record.key_name,
    );
    const liveMeta = await readLiveKeyMeta(record.key_name, namespace);
    if (
      liveMeta &&
      record.pinned_key_version != null &&
      liveMeta.latest_version !== record.pinned_key_version
    ) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "key changed since this request was raised",
          detail: `pinned version ${record.pinned_key_version} no longer matches the live version ${liveMeta.latest_version} — this destroy request needs to be re-filed against the current key, not approved as-is`,
        },
      };
    }
  }

  return { ok: true, approver: approver ?? "arcanium-api" };
}

// GET /api/v1/approvals
// Returns all pending approvals (status = 'pending') by default.
// Query param ?all=true returns all approvals regardless of status.
approvalsRouter.get("/", async (req, res, next) => {
  try {
    const all = req.query.all === "true";
    const scope = await tenantScope(req);
    const cols = `id, app_id, key_name, action, status, requester, approver,
                  reason, accessor, source, supplier_id, request_id, created_at, updated_at`;
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

    // Prompt 19 — this route previously had no authorization or tenant-scope
    // check: any authenticated session could create an approval request
    // against any application, cross-tenant.
    const scope = await tenantScope(req);
    const { supplierId, vaultNamespace, environment } = await approvalTenant({
      supplier_id,
      app_id,
    });
    if (scope.scoped && supplierId && !scope.supplierIds.includes(supplierId)) {
      return res.status(404).json({ error: "not found" });
    }
    const decision = authorize({
      identity: req.identity,
      action: resolveApprovalAction(action),
      tenant: vaultNamespace,
      env: environment,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "approve-create",
        reason: decision.reason,
      });

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
         (app_id, key_name, action, requester, accessor, reason, source, supplier_id, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, app_id, key_name, action, status, requester, accessor, reason, source, supplier_id, request_id, created_at`,
      [
        app_id,
        key_name,
        action,
        requester,
        accessor ?? null,
        reason ?? null,
        source ?? "external",
        supplier_id && UUID_RE.test(supplier_id) ? supplier_id : null,
        req.requestId,
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
    const ctx = await approvalContext(req.params.id);
    const decision = authorize({
      identity: req.identity,
      action: "approve",
      tenant: ctx?.vaultNamespace ?? null,
      env: ctx?.environment ?? null,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "approve",
        reason: decision.reason,
      });

    // Fetch the pending approval
    const { rows } = await query(
      `SELECT id, status, accessor, action, app_id, key_name, pinned_key_version
         FROM approval_requests WHERE id = $1`,
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
    // Prompt 39 — this endpoint used to only ever RECORD the approval,
    // trusting that Vault authorize step had genuinely happened. It now
    // verifies that live, plus re-checks a destroy request's pinned key
    // version hasn't drifted since it was raised — see
    // verifyApprovalGate()'s own header.
    const gate = await verifyApprovalGate(record);
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    // Update approval record
    const { rows: updated } = await query(
      `UPDATE approval_requests
       SET status = 'approved', approver = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, app_id, key_name, action, status, approver, accessor, updated_at`,
      [req.params.id, gate.approver],
    );
    approvalEvent("approved", "local");
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
    const ctx = await approvalContext(req.params.id);
    const decision = authorize({
      identity: req.identity,
      action: "approve",
      tenant: ctx?.vaultNamespace ?? null,
      env: ctx?.environment ?? null,
    });
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
    approvalEvent("rejected", "local");
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
    // Prompt 19 — this route had no authorization check at all: it calls
    // Vault's Control Group authorize API (Prompt 08), the same CISO-weight
    // action as POST /:id/approve, but was reachable by any authenticated
    // session with no role or tenant check.
    const { rows } = await query(
      `SELECT ar.id, ar.status, ar.supplier_id, ar.accessor, ar.action,
              ar.app_id, ar.key_name, ar.pinned_key_version,
              s.vault_namespace, a.environment
         FROM approval_requests ar
         LEFT JOIN applications a ON a.id = ar.app_id
         LEFT JOIN suppliers s ON s.id = COALESCE(ar.supplier_id, a.supplier_id)
        WHERE ar.accessor = $1`,
      [req.params.accessor],
    );
    if (!rows.length) return next(notFound());
    const record = rows[0];

    const scope = await tenantScope(req);
    if (
      scope.scoped &&
      record.supplier_id &&
      !scope.supplierIds.includes(record.supplier_id)
    ) {
      return next(notFound());
    }
    const decision = authorize({
      identity: req.identity,
      action: "approve",
      tenant: record.vault_namespace ?? null,
      env: record.environment ?? null,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "approve",
        reason: decision.reason,
      });

    if (record.status !== "pending")
      return res
        .status(409)
        .json({ error: "approval is not pending", status: record.status });

    // Prompt 39 — same live Control Group + pinned-version verification
    // as POST /:id/approve (verifyApprovalGate()). When Vault names a
    // real authorizing entity, that's more truthful than the guessed
    // cli-operator/arcanium-api label below and takes precedence.
    const gate = await verifyApprovalGate(record);
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const approver =
      gate.approver !== "arcanium-api"
        ? gate.approver
        : source === "manual"
          ? "cli-operator"
          : "arcanium-api";
    const { rows: updated } = await query(
      `UPDATE approval_requests
       SET status = 'approved', approver = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, app_id, key_name, action, status, approver, accessor, updated_at`,
      [record.id, approver],
    );
    approvalEvent("approved", source === "manual" ? "manual" : "local");
    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});
