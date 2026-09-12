// routes/reconciliation.js — Prompt 20: Desired State + Reconciliation.
//
// GET /api/v1/reconciliation and GET /api/v1/reconciliation/:run_id are
// brand-new routes this phase introduces — they call tenantScope(req) from
// their first commit, not as a follow-up fix (Phase 18's own execution log
// found GET /api/v1/applications/:id had no tenant-scope check at all;
// this phase's design rule is explicit about not repeating that).

import { Router } from "express";
import { query } from "../db.js";
import { tenantScope } from "../auth/index.js";
import { authorize, roleVerdict } from "../auth/authorize.js";
import { teamReadScope, scopedReadDenied } from "../auth/scope.js";
import {
  runSweep,
  reconcileRun,
  acceptException,
  getDispositionFor,
  runTenant,
} from "../reconciliation/engine.js";
import {
  upsertDesiredState,
  getDesiredState,
  getDesiredStateHistory,
} from "../reconciliation/desiredState.js";
import { validateRequestBody } from "../middleware/validateRequest.js";

export const reconciliationRouter = Router();

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

// GET /api/v1/reconciliation
// One row per desired_state, joined to its latest reconciliation_runs row
// and a live-derived disposition. observation_status and disposition are
// two independent fields, never merged (input/36).
reconciliationRouter.get("/", async (req, res, next) => {
  try {
    const scope = await tenantScope(req);
    const params = [];
    const clauses = [];
    if (scope.scoped) {
      params.push(scope.supplierIds);
      clauses.push(`a.supplier_id = ANY($${params.length})`);
    } else {
      // Prompt 27, Deliverable 3/6 — no estate-wide read role: narrow by
      // whatever scoped grants the identity actually has (env and/or
      // team), never a 403 for a read that's merely scoped rather than
      // denied outright. An identity with an estate-wide read role (the
      // common case today) is left completely unrestricted, exactly as
      // before this prompt.
      const estateWideRead = (req.identity?.roles || []).some(
        (r) => roleVerdict(r, "read") === true,
      );
      if (!estateWideRead) {
        const grants = req.identity?.scopes || [];
        const envUnion = new Set();
        let envRestricted = false;
        for (const g of grants) {
          const v = roleVerdict(g.role, "read");
          if (v !== true && v !== "limited") continue;
          if (g.envScopes.length) {
            envRestricted = true;
            for (const e of g.envScopes) envUnion.add(e);
          }
        }
        if (envRestricted) {
          params.push([...envUnion]);
          clauses.push(`a.environment = ANY($${params.length})`);
        }
        const team = await teamReadScope(req.identity);
        if (team.scoped && team.supplierIds !== null) {
          params.push(team.supplierIds);
          clauses.push(`a.supplier_id = ANY($${params.length})`);
        }
        // Neither env- nor team-restricted, and no estate-wide read role
        // either: no scoped grant applies at all — see nothing (deny-safe
        // empty list, not an error, matching the same "scoped, not denied"
        // shape as the cases above).
        if (!envRestricted && !(team.scoped && team.supplierIds !== null)) {
          clauses.push("false");
        }
      }
    }
    // Optional ?env= query filter, intersected with (not a bypass of) the
    // scope narrowing above — any caller may ask to see only one
    // environment; it can only ever narrow further, never widen access.
    if (typeof req.query.env === "string" && req.query.env) {
      params.push(req.query.env);
      clauses.push(`a.environment = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await query(
      `SELECT ds.id, ds.application_id, a.name AS application_name, a.supplier_id,
              s.vault_namespace, ds.key_name, ds.requirement, ds.desired_value,
              ds.version, ds.source, ds.changed_by, ds.changed_reason, ds.updated_at,
              lr.id AS run_id, lr.observed_value, lr.status, lr.observed_at, lr.detail
         FROM desired_state ds
         JOIN applications a ON a.id = ds.application_id
         LEFT JOIN suppliers s ON s.id = a.supplier_id
         LEFT JOIN LATERAL (
           SELECT * FROM reconciliation_runs r
            WHERE r.desired_state_id = ds.id
            ORDER BY r.observed_at DESC LIMIT 1
         ) lr ON true
         ${where}
        ORDER BY ds.updated_at DESC`,
      params,
    );

    let out = [];
    for (const r of rows) {
      const disposition = r.run_id
        ? await getDispositionFor(r.id, r.status)
        : "OPEN";
      out.push({
        desired_state_id: r.id,
        application_id: r.application_id,
        application_name: r.application_name,
        tenant: r.vault_namespace ?? null,
        key_name: r.key_name,
        requirement: r.requirement,
        desired_value: r.desired_value,
        version: r.version,
        source: r.source,
        changed_by: r.changed_by,
        changed_reason: r.changed_reason,
        updated_at: r.updated_at,
        latest_run: r.run_id
          ? {
              id: r.run_id,
              observed_value: r.observed_value,
              status: r.status,
              observed_at: r.observed_at,
              detail: r.detail,
            }
          : null,
        observation_status: r.status ?? "UNKNOWN",
        disposition,
      });
    }

    if (req.query.status) {
      const s = String(req.query.status).toUpperCase();
      out = out.filter((r) => r.observation_status === s);
    }
    if (req.query.disposition) {
      const d = String(req.query.disposition).toUpperCase();
      out = out.filter((r) => r.disposition === d);
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/reconciliation/run
// Body: { desired_state_id? } — omit to sweep every desired_state row this
// session can see (tenant-scoped for supplier-admins automatically; a
// supplier-admin's sweep can never observe another tenant's applications).
// This is an observation, not a corrective action — gated the same way a
// read is (matrix: read is estate-wide for ciso/architect/operator/auditor,
// 'limited' — own tenant only — for supplier-admin).
reconciliationRouter.post("/run", async (req, res, next) => {
  try {
    const { desired_state_id } = req.body ?? {};
    const scope = await tenantScope(req);

    if (desired_state_id) {
      validateUuid(desired_state_id);
      const { rows } = await query(
        `SELECT a.supplier_id, a.environment, s.vault_namespace
           FROM desired_state ds
           JOIN applications a ON a.id = ds.application_id
           LEFT JOIN suppliers s ON s.id = a.supplier_id
          WHERE ds.id = $1`,
        [desired_state_id],
      );
      if (!rows.length) return next(notFound());
      if (scope.scoped && !scope.supplierIds.includes(rows[0].supplier_id))
        return next(notFound());
      const decision = authorize({
        identity: req.identity,
        action: "read",
        tenant: rows[0].vault_namespace ?? null,
        env: rows[0].environment ?? null,
      });
      if (decision.decision !== "ALLOW")
        return res.status(403).json({
          error: "forbidden",
          action: "read",
          reason: decision.reason,
        });
      const results = await runSweep({ desiredStateId: desired_state_id });
      return res.json(results);
    }

    // Prompt 27 — this bulk path has no single resource to check env/team
    // against, so a scoped grant (which requires a specific env/team to
    // match) can never satisfy it — only an estate-wide role can. Found
    // live while wiring this prompt in: before this check, a scoped-only
    // identity (persona "scoped", no MATRIX entry) would reach here with
    // no gate at all and run an entirely unscoped sweep.
    const decision = authorize({ identity: req.identity, action: "read" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "read",
        reason: decision.reason,
      });
    // Estate-wide sweep, implicitly narrowed to the caller's own tenant(s)
    // when scoped — never a separate opt-in the caller could forget.
    const results = await runSweep(
      scope.scoped ? { supplierIds: scope.supplierIds } : {},
    );
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/reconciliation/desired-state/:id
// Edits the desired value itself (e.g. 30 days -> 90 days) — the write path
// the domain model in Deliverable 1 exists for (input/36's "who changed the
// intent... under what authorization"). Same governance weight as setting
// rotation_days at provision time (both are declaring policy intent).
reconciliationRouter.patch("/desired-state/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const existing = await getDesiredState(req.params.id);
    if (!existing) return next(notFound());

    const { rows: appRows } = await query(
      `SELECT a.supplier_id, a.environment, s.vault_namespace
         FROM applications a LEFT JOIN suppliers s ON s.id = a.supplier_id
        WHERE a.id = $1`,
      [existing.application_id],
    );
    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(appRows[0]?.supplier_id))
      return next(notFound());
    const decision = authorize({
      identity: req.identity,
      action: "provision",
      tenant: appRows[0]?.vault_namespace ?? null,
      env: appRows[0]?.environment ?? null,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });

    const { desired_value, reason } = req.body ?? {};
    if (
      !desired_value ||
      typeof desired_value !== "object" ||
      !Number.isFinite(desired_value.days) ||
      desired_value.days <= 0
    ) {
      return res.status(400).json({
        error: "desired_value.days must be a positive number",
        field: "desired_value",
      });
    }

    const updated = await upsertDesiredState({
      applicationId: existing.application_id,
      keyName: existing.key_name,
      requirement: existing.requirement,
      desiredValue: { days: desired_value.days },
      source: "operator",
      changedBy: req.identity?.user ?? "arcanium",
      changedGroups: req.identity?.groups ?? [],
      changedReason: reason ?? null,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/reconciliation/:run_id
reconciliationRouter.get("/:run_id", async (req, res, next) => {
  try {
    validateUuid(req.params.run_id);
    const { rows } = await query(
      `SELECT rr.id, rr.desired_state_id, rr.desired_state_version, rr.observed_value,
              rr.status, rr.observed_at, rr.detail,
              ds.application_id, ds.key_name, ds.requirement, ds.desired_value,
              ds.version, ds.source, ds.changed_by, ds.changed_groups, ds.changed_reason, ds.updated_at,
              a.name AS application_name, a.supplier_id, a.environment, s.vault_namespace
         FROM reconciliation_runs rr
         JOIN desired_state ds ON ds.id = rr.desired_state_id
         JOIN applications a ON a.id = ds.application_id
         LEFT JOIN suppliers s ON s.id = a.supplier_id
        WHERE rr.id = $1`,
      [req.params.run_id],
    );
    if (!rows.length) return next(notFound());
    const r = rows[0];

    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(r.supplier_id))
      return next(notFound());
    // Prompt 27, Deliverable 5 — same scoped-grant (team/env) fix as
    // applications.js's GET /:id above; found by this prompt's own
    // required audit.
    if (
      await scopedReadDenied(req.identity, {
        supplierId: r.supplier_id,
        env: r.environment,
      })
    ) {
      return next(notFound());
    }

    const disposition = await getDispositionFor(r.desired_state_id, r.status);
    const history = await getDesiredStateHistory({
      id: r.desired_state_id,
      version: r.version,
      desired_value: r.desired_value,
      changed_by: r.changed_by,
      changed_groups: r.changed_groups,
      changed_reason: r.changed_reason,
      updated_at: r.updated_at,
    });
    const { rows: actions } = await query(
      `SELECT ra.* FROM reconciliation_actions ra
         JOIN reconciliation_runs rr2 ON rr2.id = ra.run_id
        WHERE rr2.desired_state_id = $1
        ORDER BY ra.created_at DESC`,
      [r.desired_state_id],
    );

    res.json({
      run: {
        id: r.id,
        desired_state_version: r.desired_state_version,
        observed_value: r.observed_value,
        status: r.status,
        observed_at: r.observed_at,
        detail: r.detail,
      },
      desired_state_id: r.desired_state_id,
      application_id: r.application_id,
      application_name: r.application_name,
      tenant: r.vault_namespace ?? null,
      key_name: r.key_name,
      requirement: r.requirement,
      desired_value: r.desired_value,
      observation_status: r.status,
      disposition,
      desired_state_history: history,
      actions,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/reconciliation/:run_id/reconcile
reconciliationRouter.post("/:run_id/reconcile", async (req, res, next) => {
  try {
    validateUuid(req.params.run_id);
    const tenant = await runTenant(req.params.run_id);
    if (!tenant) return next(notFound());
    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(tenant.supplier_id))
      return next(notFound());
    const decision = authorize({
      identity: req.identity,
      action: "reconcile",
      tenant: tenant.vault_namespace ?? null,
      env: tenant.environment ?? null,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "reconcile",
        reason: decision.reason,
      });

    const result = await reconcileRun(req.params.run_id, {
      actor: req.identity?.user ?? "arcanium",
      actorGroups: req.identity?.groups ?? [],
    });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/v1/reconciliation/:run_id/accept-exception
// Body: { reason, expires_at } — both required (input/36: no open-ended
// exceptions). CISO-weight, same matrix row as /approvals/:id/approve.
// Prompt 22, Deliverable 2 — validated against openapi/arcanium.yaml's own
// requestBody schema for this path, not a re-typed copy of the same rule
// acceptException() already enforces below; a genuine proof the generated
// validation middleware is wired to a real route, not just built and
// ignored (see middleware/validateRequest.js's own header for scope).
reconciliationRouter.post(
  "/:run_id/accept-exception",
  validateRequestBody(
    "/api/v1/reconciliation/{run_id}/accept-exception",
    "post",
  ),
  async (req, res, next) => {
    try {
      validateUuid(req.params.run_id);
      const tenant = await runTenant(req.params.run_id);
      if (!tenant) return next(notFound());
      const scope = await tenantScope(req);
      if (scope.scoped && !scope.supplierIds.includes(tenant.supplier_id))
        return next(notFound());
      const decision = authorize({
        identity: req.identity,
        action: "approve",
        tenant: tenant.vault_namespace ?? null,
        env: tenant.environment ?? null,
      });
      if (decision.decision !== "ALLOW")
        return res.status(403).json({
          error: "forbidden",
          action: "approve",
          reason: decision.reason,
        });

      const { reason, expires_at } = req.body ?? {};
      const result = await acceptException(req.params.run_id, {
        actor: req.identity?.user ?? "arcanium",
        actorGroups: req.identity?.groups ?? [],
        reason,
        expiresAt: expires_at,
      });
      res.json(result);
    } catch (err) {
      if (err.status)
        return res.status(err.status).json({ error: err.message });
      next(err);
    }
  },
);
