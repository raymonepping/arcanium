// routes/jobs.js — Prompt 14.2 — provisioning job history + step drill-down.
// Prompt 24, Deliverable 4 — stuck-job detection (status=stuck).

import { Router } from "express";
import { query } from "../db.js";
import config from "../config.js";

export const jobsRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// config.stuckJobThresholdMinutes is shared with the "Stuck job age" SLO
// (telemetry/slo.js) — a job counts as stuck the same way in both places.
const STUCK_THRESHOLD_MINUTES = config.stuckJobThresholdMinutes;

// GET /api/v1/jobs?status=failed&limit=50
// GET /api/v1/jobs?status=stuck — derived (RUNNING + age > threshold),
// never a separately stored status; a job that finishes between two polls
// simply stops appearing here, it doesn't need to be "un-flagged".
jobsRouter.get("/", async (req, res, next) => {
  try {
    const params = [];
    let where = "";
    if (req.query.status === "stuck") {
      where = `WHERE status = 'running' AND updated_at < now() - interval '${STUCK_THRESHOLD_MINUTES} minutes'`;
    } else if (req.query.status) {
      params.push(String(req.query.status));
      where = `WHERE status = $${params.length}`;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    params.push(limit);
    const { rows } = await query(
      `SELECT id, target_type, target_id, target_name, action, status, steps,
              error, requested_by, request_id, created_at, updated_at,
              EXTRACT(EPOCH FROM (now() - updated_at))::int AS stuck_age_seconds
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
