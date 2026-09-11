// routes/suppliers.js — CRUD for registered suppliers + supplier-scoped Vault key inventory.

import { Router } from "express";
import { supplierFields } from "../supplier-validation.js";
import { query } from "../db.js";
import { listNamespaceTransitKeys } from "../vault.js";
import { createJob, runOrQueue } from "../provisioner/steps.js";
import {
  provisionSupplier,
  deprovisionSupplier,
} from "../provisioner/supplier.js";
import { tenantScope } from "../auth/index.js";
import { checkIsolation } from "../suppliers/isolation.js";
import { authorize } from "../auth/authorize.js";

export const suppliersRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[a-z0-9_-]{1,128}$/i;

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

// Prompt 19 — authorize()'s "limited" verdict (supplier-admin) only ALLOWs
// when a `tenant` string is passed and matches identity.tenantScopes; a
// call with no tenant always denies a "limited" persona, even for their own
// resource. This resolves the supplier's own vault_namespace so that tenant
// check can actually succeed — found while closing these routes: the same
// missing-tenant-param bug already existed in applications.js's POST routes.
async function namespaceOf(supplierId) {
  const { rows } = await query(
    "SELECT vault_namespace FROM suppliers WHERE id = $1",
    [supplierId],
  );
  return rows[0]?.vault_namespace ?? null;
}

// GET /api/v1/suppliers
suppliersRouter.get("/", async (req, res, next) => {
  try {
    const scope = await tenantScope(req);
    const { rows } = scope.scoped
      ? await query(
          "SELECT id, name, vault_namespace, sla_tier, created_at FROM suppliers WHERE id = ANY($1) ORDER BY created_at DESC",
          [scope.supplierIds],
        )
      : await query(
          "SELECT id, name, vault_namespace, sla_tier, created_at FROM suppliers ORDER BY created_at DESC",
        );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/suppliers/isolation — Prompt 16.2
// Live bidirectional namespace-boundary check across all registered tenants.
suppliersRouter.get("/isolation", async (_req, res, next) => {
  try {
    res.json(await checkIsolation());
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/suppliers
// Prompt 14.2 — after the registry insert, Arcanium provisions the real Vault
// tenant: namespace + approle + policy + transit mount + rate-limit quota.
// Pass ?dry=true to skip provisioning (registry row only).
suppliersRouter.post("/", async (req, res, next) => {
  try {
    if ((await tenantScope(req)).scoped)
      return res
        .status(403)
        .json({ error: "supplier-admins cannot create tenants" });
    // Role check (Prompt 18) — the tenantScope check above only ever blocked
    // supplier-admins; ciso/auditor could previously create tenants too.
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { name, vault_namespace, sla_tier } = supplierFields(req.body);
    const { rows } = await query(
      `INSERT INTO suppliers (name, vault_namespace, sla_tier)
       VALUES ($1, $2, $3)
       RETURNING id, name, vault_namespace, sla_tier, created_at`,
      [name, vault_namespace, sla_tier],
    );
    const supplier = rows[0];

    if (req.query.dry === "true") {
      return res.status(201).json({ ...supplier, provisioning_job: null });
    }

    const job = await createJob({
      target_type: "supplier",
      target_id: supplier.id,
      target_name: supplier.name,
      action: "provision",
      requested_by: req.identity?.user ?? "arcanium",
      params: {
        vault_namespace: supplier.vault_namespace,
        sla_tier: supplier.sla_tier,
      },
    });
    const finished = await runOrQueue(job, (j) =>
      provisionSupplier(j, supplier),
    );

    if (finished.queued) {
      return res.status(201).json({ ...supplier, provisioning_job: finished });
    }
    if (finished.status !== "succeeded") {
      // Vault provisioning failed and was rolled back — undo the registry row too.
      await query("DELETE FROM suppliers WHERE id = $1", [supplier.id]).catch(
        () => {},
      );
      return res.status(502).json({
        error: "Supplier namespace provisioning failed and was rolled back.",
        provisioning_job: finished,
      });
    }
    res.status(201).json({ ...supplier, provisioning_job: finished });
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ error: "supplier name or namespace already exists" });
    next(err);
  }
});

// GET /api/v1/suppliers/:id
suppliersRouter.get("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(req.params.id))
      throw notFound();
    const { rows } = await query(
      "SELECT id, name, vault_namespace, sla_tier, created_at FROM suppliers WHERE id = $1",
      [req.params.id],
    );
    if (!rows.length) throw notFound();
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Update registry metadata only; Vault namespace provisioning is a separate workflow.
// Prompt 19 — this route had NO authorization check of any kind (neither
// role nor tenant): any authenticated session, including a different
// tenant's supplier-admin, could patch any supplier's registry row. Closed
// the same way Phase 18 closed GET /applications/:id — role via
// authorize(), tenant via tenantScope(), both checked, neither assumed.
suppliersRouter.patch("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(req.params.id))
      throw notFound();
    const decision = authorize({
      identity: req.identity,
      action: "provision",
      tenant: await namespaceOf(req.params.id),
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const fields = supplierFields(req.body, true);
    const names = Object.keys(fields);
    const { rows } = await query(
      `UPDATE suppliers SET ${names.map((name, i) => `${name} = $${i + 2}`).join(", ")}
       WHERE id = $1 RETURNING id, name, vault_namespace, sla_tier, created_at`,
      [req.params.id, ...Object.values(fields)],
    );
    if (!rows.length) throw notFound();
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ error: "supplier name or namespace already exists" });
    next(err);
  }
});

// DELETE /api/v1/suppliers/:id
// Prompt 14.2 — de-provisions the Vault namespace (guarded: refuses a namespace
// that still holds transit keys unless ?force=true), then removes the row.
// Prompt 19 — deliberately stricter than the matrix's generic "limited"
// destroy_request for supplier-admin: deleting a WHOLE tenant is a
// platform-level action, not something a tenant-admin should ever self-serve
// (unlike requesting destruction of one key within their own tenant). The
// existing blanket block stays; authorize() below additionally denies
// auditor (previously the only check was "not a supplier-admin" — ciso,
// architect, operator, AND auditor could all reach this far).
suppliersRouter.delete("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    if ((await tenantScope(req)).scoped)
      return res
        .status(403)
        .json({ error: "supplier-admins cannot delete tenants" });
    const decision = authorize({
      identity: req.identity,
      action: "destroy_request",
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "destroy_request",
        reason: decision.reason,
      });
    const { rows: sup } = await query(
      "SELECT id, name, vault_namespace, sla_tier FROM suppliers WHERE id = $1",
      [req.params.id],
    );
    if (!sup.length) throw notFound();

    const { rows: linked } = await query(
      `SELECT
         (SELECT count(*) FROM applications WHERE supplier_id = $1) AS apps,
         (SELECT count(*) FROM approval_requests WHERE supplier_id = $1) AS approvals`,
      [req.params.id],
    );
    if (Number(linked[0].apps) > 0 || Number(linked[0].approvals) > 0) {
      return res.status(409).json({
        error:
          "Supplier is linked to applications or governance records. Reassign applications and retain governance history before removal.",
      });
    }

    // Deprovision + row cleanup are coupled — always synchronous.
    const job = await createJob({
      target_type: "supplier",
      target_id: sup[0].id,
      target_name: sup[0].name,
      action: "deprovision",
      requested_by: req.identity?.user ?? "arcanium",
      params: { force: req.query.force === "true" },
    });
    const finished = await deprovisionSupplier(job, sup[0], {
      force: req.query.force === "true",
    });
    if (finished.status !== "succeeded") {
      return res.status(409).json({
        error: "Namespace de-provisioning failed — the supplier was kept.",
        provisioning_job: finished,
      });
    }

    await query("DELETE FROM suppliers WHERE id = $1", [req.params.id]);
    res.status(200).json({ deleted: true, provisioning_job: finished });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/suppliers/:id/applications
suppliersRouter.get("/:id/applications", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    // Verify supplier exists
    const { rows: sup } = await query(
      "SELECT id FROM suppliers WHERE id = $1",
      [req.params.id],
    );
    if (!sup.length) throw notFound();
    const { rows } = await query(
      `SELECT id, name, description, registered_at FROM applications
       WHERE supplier_id = $1 ORDER BY registered_at DESC`,
      [req.params.id],
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/suppliers/:id/keys
// Returns Transit key inventory from the supplier's Vault namespace.
suppliersRouter.get("/:id/keys", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const { rows } = await query(
      "SELECT vault_namespace FROM suppliers WHERE id = $1",
      [req.params.id],
    );
    if (!rows.length) throw notFound();
    const keys = await listNamespaceTransitKeys(rows[0].vault_namespace);
    res.json(keys);
  } catch (err) {
    // 403 = arcanium-api token has no LIST permission in the supplier namespace.
    // Return an empty array rather than propagating as 500 — the namespace boundary
    // is by design; operators use vault CLI or the supplier's own credentials.
    if (err.vaultStatus === 403) return res.json([]);
    next(err);
  }
});
