// routes/evidence.js — Prompt 15.3
// The evidence trail: ingested workload crypto operations (from the Vault audit
// log) unioned with governance decisions (approval records). One place.

import { Router } from "express";
import { query } from "../db.js";
import { tenantScope } from "../auth/index.js";

export const evidenceRouter = Router();

// Prompt 16.6 — map a recorded operation onto one of the six Key Management
// Lifecycle stages (Generate → Distribute → Store → Use → Rotate → Destroy).
// Pure derivation over fields already stored; nothing new is ingested.
export const KML_STAGES = [
  "Generate",
  "Distribute",
  "Store",
  "Use",
  "Rotate",
  "Destroy",
];

export function lifecycleStage(operation = "", resourceType = "") {
  const op = String(operation).toLowerCase();
  const rt = String(resourceType).toLowerCase();

  if (/rotate|renew|rewrap|re-?key|sync/.test(op)) return "Rotate";
  if (/destroy|revoke|delete|remove|deprovision/.test(op)) return "Destroy";
  if (/encrypt|decrypt|sign|verify|hmac|unwrap/.test(op)) return "Use";
  // Orchestration events: a supplier tenant is Generate (namespace + engines),
  // an application is Distribute (identity + access to an existing engine).
  if (/provision|register/.test(op)) {
    if (rt === "supplier" || rt === "namespace") return "Generate";
    return "Distribute";
  }
  if (
    /issue|distribute|bind|enroll|role-?id|secret-?id|approle|policy/.test(op)
  )
    return "Distribute";
  if (
    /create|generate|namespace|mount|import|keygen/.test(op) ||
    op === "encrypt-key" ||
    rt === "namespace"
  )
    return "Generate";
  if (/isolation-check/.test(op)) return "Distribute";
  if (rt === "key") return "Use";
  return "Generate";
}

// GET /api/v1/evidence?source=&operation=&outcome=&supplier=&limit=
evidenceRouter.get("/", async (req, res, next) => {
  try {
    const scope = await tenantScope(req);
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    // Pull a wider window from SQL than we display, so the lifecycle-stage
    // classification and the stage tallies see the older rotate/destroy/issue
    // rows that the newest-N encrypt/decrypt traffic would otherwise crowd out.
    const scan = Math.min(limit * 4, 2000);

    // Ingested crypto-operation evidence.
    const evRows = (
      await query(
        `SELECT e.ts, e.actor, e.source, e.operation, e.resource_type, e.resource_id,
                e.namespace, e.supplier_id, e.outcome, 'audit-log' AS origin, s.name AS supplier
         FROM evidence e LEFT JOIN suppliers s ON s.id = e.supplier_id
         ${scope.scoped ? "WHERE e.supplier_id = ANY($1)" : ""}
         ORDER BY e.ts DESC LIMIT ${scan}`,
        scope.scoped ? [scope.supplierIds] : [],
      )
    ).rows;

    // Governance evidence, derived from approvals.
    const apRows = (
      await query(
        `SELECT a.updated_at AS ts, a.requester AS actor, a.source, a.action AS operation,
                'key' AS resource_type, a.key_name AS resource_id, NULL AS namespace,
                a.supplier_id,
                CASE a.status WHEN 'approved' THEN 'ok' WHEN 'rejected' THEN 'denied' ELSE 'ok' END AS outcome,
                'approval' AS origin, s.name AS supplier
         FROM approval_requests a LEFT JOIN suppliers s ON s.id = a.supplier_id
         ${scope.scoped ? "WHERE (a.supplier_id = ANY($1) OR a.app_id IN (SELECT id FROM applications WHERE supplier_id = ANY($1)))" : ""}
         ORDER BY a.updated_at DESC LIMIT ${scan}`,
        scope.scoped ? [scope.supplierIds] : [],
      )
    ).rows;

    // Orchestration evidence — provisioning / rotation / destroy that Arcanium
    // itself recorded. This is what puts real rows under Generate & Distribute.
    const leRows = scope.scoped
      ? []
      : (
          await query(
            `SELECT le.created_at AS ts, le.actor, le.source, le.event AS operation,
                    le.resource_type, le.resource_id, NULL AS namespace, NULL AS supplier_id,
                    CASE WHEN le.event LIKE '%failed%' THEN 'error' ELSE 'ok' END AS outcome,
                    'orchestration' AS origin,
                    COALESCE(s.name, a2.name) AS supplier
             FROM lifecycle_events le
             LEFT JOIN suppliers s ON s.id::text = le.resource_id AND le.resource_type = 'supplier'
             LEFT JOIN (SELECT ap.id, sup.name FROM applications ap LEFT JOIN suppliers sup ON sup.id = ap.supplier_id) a2
               ON a2.id::text = le.resource_id AND le.resource_type = 'application'
             ORDER BY le.created_at DESC LIMIT ${scan}`,
          )
        ).rows;

    let rows = [...evRows, ...apRows, ...leRows]
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .map((r) => ({
        ...r,
        lifecycle_stage: lifecycleStage(r.operation, r.resource_type),
      }));

    // Tally every stage over the full scan window BEFORE the display slice, so
    // the UI strip shows real totals even when recent encrypt traffic dominates.
    const stage_counts = Object.fromEntries(KML_STAGES.map((s) => [s, 0]));
    for (const r of rows) stage_counts[r.lifecycle_stage]++;

    if (req.query.source)
      rows = rows.filter((r) => r.source === req.query.source);
    if (req.query.operation)
      rows = rows.filter((r) => r.operation === req.query.operation);
    if (req.query.outcome)
      rows = rows.filter((r) => r.outcome === req.query.outcome);
    if (req.query.origin)
      rows = rows.filter((r) => r.origin === req.query.origin);
    if (req.query.stage && KML_STAGES.includes(req.query.stage))
      rows = rows.filter((r) => r.lifecycle_stage === req.query.stage);

    res.json({ rows: rows.slice(0, limit), stage_counts, total: rows.length });
  } catch (err) {
    next(err);
  }
});
