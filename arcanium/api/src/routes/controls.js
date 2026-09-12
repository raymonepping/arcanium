// routes/controls.js — Prompt 21: Evidence Model v2.
//
// GET /api/v1/controls and GET /api/v1/controls/:id are brand-new routes
// this phase introduces — they call tenantScope(req) from their first
// commit, the same way GET /api/v1/applications/:id was fixed in Phase 18
// (that route had no tenant-scope check at all before it was found and
// closed) — write it correctly from day one this time.

import { Router } from "express";
import { query } from "../db.js";
import { tenantScope } from "../auth/index.js";
import { roleVerdict } from "../auth/authorize.js";
import { teamReadScope } from "../auth/scope.js";

export const controlsRouter = Router();

function notFound() {
  const err = new Error("not found");
  err.status = 404;
  return err;
}

// Filters assessment rows down to the caller's own tenant/team scope.
// 'estate'-scoped assessments (platform-wide controls — KEY-INV-01,
// TEN-ISO-01, AUD-01, WLI-01, NEG-AUTHZ-01, AUTO-01, GOV-01) are never
// visible to a scoped session (tenant- or team-scoped); only per-
// application assessments (ROT-POL-01) under the caller's own namespace
// are — true whether the caller is a supplier-admin scoped by tenant or,
// as of Prompt 27, an operator/auditor scoped by team.
//
// Prompt 27, Configuration C's own named gap: "GET /api/v1/controls
// returns all assessments for an operator session, regardless of team."
// Fixed here — an identity with no estate-wide read role is now narrowed
// by whichever scoped grant (tenant or team) actually applies, filtered
// rather than denied outright.
async function filterToScope(req, rows) {
  const scope = await tenantScope(req);
  let prefixes = null; // null = unrestricted
  if (scope.scoped) {
    const { rows: sup } = await query(
      "SELECT vault_namespace FROM suppliers WHERE id = ANY($1)",
      [scope.supplierIds],
    );
    prefixes = sup.map((s) => s.vault_namespace).filter(Boolean);
  } else {
    const estateWideRead = (req.identity?.roles || []).some(
      (r) => roleVerdict(r, "read") === true,
    );
    if (!estateWideRead) {
      const team = await teamReadScope(req.identity);
      if (!team.scoped) {
        prefixes = []; // no grant at all covers read here — see nothing, not an error
      } else if (team.supplierIds !== null) {
        const { rows: sup } = await query(
          "SELECT vault_namespace FROM suppliers WHERE id = ANY($1)",
          [team.supplierIds],
        );
        prefixes = sup.map((s) => s.vault_namespace).filter(Boolean);
      }
      // team.supplierIds === null: this team covers every supplier — leave
      // prefixes null (unrestricted), same as an estate-wide read role.
    }
  }
  if (prefixes === null) return rows;
  return rows.filter((r) => prefixes.some((p) => r.scope.startsWith(`${p}/`)));
}

// GET /api/v1/controls — latest assessment per (control_id, scope) pair.
controlsRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (control_id, scope) ca.*, c.requirement, c.mandatory, c.dimension
         FROM control_assessments ca
         JOIN controls c ON c.id = ca.control_id
        ORDER BY control_id, scope, assessed_at DESC`,
    );
    res.json(await filterToScope(req, rows));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/controls/:id — one control's definition + its latest
// assessment per scope (tenant/team-filtered the same way as the list route).
controlsRouter.get("/:id", async (req, res, next) => {
  try {
    const { rows: ctrl } = await query("SELECT * FROM controls WHERE id = $1", [
      req.params.id,
    ]);
    if (!ctrl.length) return next(notFound());

    const { rows } = await query(
      `SELECT DISTINCT ON (scope) * FROM control_assessments
        WHERE control_id = $1
        ORDER BY scope, assessed_at DESC`,
      [req.params.id],
    );
    const assessments = await filterToScope(req, rows);
    res.json({ ...ctrl[0], assessments });
  } catch (err) {
    next(err);
  }
});
