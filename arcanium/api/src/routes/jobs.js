// routes/jobs.js — Prompt 14.2 — provisioning job history + step drill-down.

import { Router } from "express";
import { query } from "../db.js";

export const jobsRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/v1/jobs?status=failed&limit=50
jobsRouter.get("/", async (req, res, next) => {
  try {
    const params = [];
    let where = "";
    if (req.query.status) {
      params.push(String(req.query.status));
      where = `WHERE status = $${params.length}`;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    params.push(limit);
    const { rows } = await query(
      `SELECT id, target_type, target_id, target_name, action, status, steps,
              error, requested_by, created_at, updated_at
       FROM provisioning_jobs ${where}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/jobs/:id
jobsRouter.get("/:id", async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id))
      return res.status(400).json({ error: "invalid id" });
    const { rows } = await query(
      "SELECT * FROM provisioning_jobs WHERE id = $1",
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});
