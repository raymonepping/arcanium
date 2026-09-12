// routes/teams.js — Prompt 27, Deliverable 2: the team registry.
//
// Links a scoped OIDC group ("arcanium-<role>:team:<name>") to concrete
// supplier records, so authorize()'s scoped-grant path (Deliverable 1) can
// resolve "team:platform" into an actual set of tenants. This is
// operator-facing configuration, not a tenant-facing resource — estate-wide
// only, same as suppliers.js's own POST (no 'limited'/supplier-admin path).

import { Router } from "express";
import { query } from "../db.js";
import { authorize } from "../auth/authorize.js";

export const teamsRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[a-z0-9_-]{1,64}$/i;

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

// GET /api/v1/teams — estate-wide `read` only (a supplier-admin's 'limited'
// verdict never resolves without a `tenant` param, which this estate-level
// resource has none of — deny by default applies, same as every other
// estate-level GET in this codebase).
teamsRouter.get("/", async (req, res, next) => {
  try {
    const decision = authorize({ identity: req.identity, action: "read" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "read",
        reason: decision.reason,
      });
    const { rows } = await query(
      "SELECT id, name, description, supplier_ids, environments, created_by, created_at FROM teams ORDER BY created_at DESC",
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/teams/:id
teamsRouter.get("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "read" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "read",
        reason: decision.reason,
      });
    const { rows } = await query(
      "SELECT id, name, description, supplier_ids, environments, created_by, created_at FROM teams WHERE id = $1",
      [req.params.id],
    );
    if (!rows.length) return next(notFound());
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/teams — estate-wide `provision` only.
teamsRouter.post("/", async (req, res, next) => {
  try {
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { name, description, supplier_ids, environments } = req.body ?? {};
    if (!name || !NAME_RE.test(name))
      return res.status(400).json({
        error: "name is required and must match /^[a-z0-9_-]{1,64}$/i",
        field: "name",
      });
    if (
      supplier_ids !== undefined &&
      supplier_ids !== null &&
      (!Array.isArray(supplier_ids) ||
        supplier_ids.some((s) => !UUID_RE.test(s)))
    )
      return res.status(400).json({
        error: "supplier_ids must be an array of UUIDs or null",
        field: "supplier_ids",
      });
    if (
      environments !== undefined &&
      environments !== null &&
      (!Array.isArray(environments) ||
        environments.some((e) => typeof e !== "string"))
    )
      return res.status(400).json({
        error: "environments must be an array of strings or null",
        field: "environments",
      });

    const { rows } = await query(
      `INSERT INTO teams (name, description, supplier_ids, environments, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, supplier_ids, environments, created_by, created_at`,
      [
        name,
        description ?? null,
        supplier_ids ?? null,
        environments ?? null,
        req.identity?.user ?? "arcanium",
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "team name already registered" });
    next(err);
  }
});

// PATCH /api/v1/teams/:id
teamsRouter.patch("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { description, supplier_ids, environments } = req.body ?? {};
    if (
      supplier_ids !== undefined &&
      supplier_ids !== null &&
      (!Array.isArray(supplier_ids) ||
        supplier_ids.some((s) => !UUID_RE.test(s)))
    )
      return res.status(400).json({
        error: "supplier_ids must be an array of UUIDs or null",
        field: "supplier_ids",
      });
    if (
      environments !== undefined &&
      environments !== null &&
      (!Array.isArray(environments) ||
        environments.some((e) => typeof e !== "string"))
    )
      return res.status(400).json({
        error: "environments must be an array of strings or null",
        field: "environments",
      });

    const { rows } = await query(
      `UPDATE teams SET
         description  = COALESCE($2, description),
         supplier_ids = CASE WHEN $3::boolean THEN $4 ELSE supplier_ids END,
         environments = CASE WHEN $5::boolean THEN $6 ELSE environments END
       WHERE id = $1
       RETURNING id, name, description, supplier_ids, environments, created_by, created_at`,
      [
        req.params.id,
        description ?? null,
        supplier_ids !== undefined,
        supplier_ids ?? null,
        environments !== undefined,
        environments ?? null,
      ],
    );
    if (!rows.length) return next(notFound());
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/teams/:id
teamsRouter.delete("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { rowCount } = await query("DELETE FROM teams WHERE id = $1", [
      req.params.id,
    ]);
    if (!rowCount) return next(notFound());
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
