// routes/integrations.js — Prompt 15.4 — external integration channel registry.

import { Router } from "express";
import { query } from "../db.js";

export const integrationsRouter = Router();

// Prompt 16.4 — a 30 s heartbeat means "connected" can be tight.
const CONNECTED_MS = 3 * 60_000; // < 3 min  → connected
const DEGRADED_MS = 15 * 60_000; // 3–15 min → degraded, then stale

function liveStatus(row) {
  if (row.status === "retired") return "retired";
  if (!row.last_seen) return "declared";
  const age = Date.now() - new Date(row.last_seen).getTime();
  if (age < CONNECTED_MS) return "connected";
  if (age < DEGRADED_MS) return "degraded";
  return "stale";
}

// GET /api/v1/integrations
integrationsRouter.get("/", async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT i.id, i.name, i.kind, i.operation, i.status, i.last_seen,
              i.created_at, s.name AS supplier, s.vault_namespace
       FROM integrations i
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       ORDER BY i.name`,
    );

    // Open approval requests attributable to each channel (by requester name).
    const pend = (
      await query(
        `SELECT requester, COUNT(*)::int AS n
         FROM approval_requests WHERE status = 'pending' GROUP BY requester`,
      )
    ).rows.reduce((acc, r) => ((acc[r.requester] = r.n), acc), {});

    const channels = rows.map((r) => {
      const status = liveStatus(r);
      return {
        ...r,
        status,
        pending: pend[r.name] ?? 0,
        // Whether the channel has produced real evidence, vs merely being declared.
        observed: Boolean(r.last_seen),
        governed_by:
          r.kind === "approval-gated"
            ? "four-eyes approval (Control Group)"
            : r.kind === "kmip"
              ? "namespace-scoped KMIP role"
              : "webhook token",
        awaiting_approval: status === "connected" && (pend[r.name] ?? 0) > 0,
      };
    });

    res.json({
      channels,
      summary: {
        total: channels.length,
        connected: channels.filter((c) => c.status === "connected").length,
        observed: channels.filter((c) => c.observed).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/integrations — register a channel (admin)
integrationsRouter.post("/", async (req, res, next) => {
  try {
    const { name, kind, operation, supplier_id } = req.body ?? {};
    if (!name || !["approval-gated", "kmip", "webhook"].includes(kind))
      return res
        .status(400)
        .json({ error: "name and a valid kind are required" });
    const { rows } = await query(
      `INSERT INTO integrations (name, kind, operation, supplier_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (name) DO UPDATE SET kind = EXCLUDED.kind, operation = EXCLUDED.operation
       RETURNING *`,
      [name, kind, operation ?? null, supplier_id ?? null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/integrations/:name/heartbeat — a channel reports liveness
integrationsRouter.post("/:name/heartbeat", async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE integrations SET last_seen = now(),
         status = CASE WHEN status = 'declared' THEN 'connected' ELSE status END
       WHERE name = $1 RETURNING id, name, last_seen`,
      [req.params.name],
    );
    if (!rows.length) {
      // Auto-register unknown channels that heartbeat (webhook style).
      await query(
        `INSERT INTO integrations (name, kind, status, last_seen)
         VALUES ($1, 'webhook', 'connected', now()) ON CONFLICT (name) DO NOTHING`,
        [req.params.name],
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
