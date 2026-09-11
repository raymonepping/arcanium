// routes/applications.js — CRUD + runtime provisioning for registered applications.

import { Router } from "express";
import { query } from "../db.js";
import { createJob, runOrQueue } from "../provisioner/steps.js";
import { provisionApplication } from "../provisioner/application.js";
import { tenantScope } from "../auth/index.js";
import { authorize } from "../auth/authorize.js";

export const applicationsRouter = Router();

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

// GET /api/v1/applications
applicationsRouter.get("/", async (req, res, next) => {
  try {
    const scope = await tenantScope(req);
    const { rows } = scope.scoped
      ? await query(
          "SELECT id, name, description, supplier_id, category, registered_at FROM applications WHERE supplier_id = ANY($1) ORDER BY registered_at DESC",
          [scope.supplierIds],
        )
      : await query(
          "SELECT id, name, description, supplier_id, category, registered_at FROM applications ORDER BY registered_at DESC",
        );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/applications
applicationsRouter.post("/", async (req, res, next) => {
  try {
    const { name, description, supplier_id } = req.body ?? {};
    // Prompt 19 — authorize()'s "limited" (supplier-admin) verdict only
    // ALLOWs when `tenant` is passed and matches identity.tenantScopes; the
    // original call here never passed one, so a supplier-admin could never
    // create an application even in their own tenant — found while closing
    // these routes, not exercised by the original negative-test suite
    // (which only tested DENY for supplier-admin, never an own-tenant ALLOW).
    let tenant = null;
    if (supplier_id && UUID_RE.test(supplier_id)) {
      const { rows } = await query(
        "SELECT vault_namespace FROM suppliers WHERE id = $1",
        [supplier_id],
      );
      tenant = rows[0]?.vault_namespace ?? null;
    }
    const decision = authorize({
      identity: req.identity,
      action: "provision",
      tenant,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    if (!name)
      return res.status(400).json({ error: "name is required", field: "name" });
    if (!NAME_RE.test(name))
      return res.status(400).json({
        error: "name must match /^[a-z0-9_-]{1,128}$/i",
        field: "name",
      });
    if (description && description.length > 512)
      return res
        .status(400)
        .json({ error: "description max 512 chars", field: "description" });
    if (
      supplier_id !== undefined &&
      supplier_id !== null &&
      !UUID_RE.test(supplier_id)
    )
      return res
        .status(400)
        .json({ error: "supplier_id must be a UUID", field: "supplier_id" });

    const { rows } = await query(
      "INSERT INTO applications (name, description, supplier_id) VALUES ($1, $2, $3) RETURNING id, name, description, supplier_id, registered_at",
      [name, description ?? null, supplier_id ?? null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "name already registered" });
    next(err);
  }
});

// GET /api/v1/applications/:id
applicationsRouter.get("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const { rows: apps } = await query(
      "SELECT id, name, description, supplier_id, category, registered_at FROM applications WHERE id = $1",
      [req.params.id],
    );
    if (!apps.length) return next(notFound());

    // Prompt 18 — this route had no tenant-scope check at all: any
    // authenticated supplier-admin could read any application by id,
    // cross-tenant. GET / already scoped correctly; this did not.
    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(apps[0].supplier_id)) {
      return next(notFound());
    }

    const { rows: profiles } = await query(
      "SELECT id, type, vault_path, created_at FROM crypto_profiles WHERE application_id = $1 ORDER BY created_at",
      [req.params.id],
    );
    res.json({ ...apps[0], crypto_profiles: profiles });
  } catch (err) {
    next(err);
  }
});

// Prompt 19 — resolves the application's tenant namespace for authorize()'s
// "limited" (supplier-admin) verdict, which only ALLOWs when a `tenant`
// string is passed and matches identity.tenantScopes. Also doubles as the
// existence + supplier_id lookup PATCH/DELETE need anyway.
async function applicationTenant(id) {
  const { rows } = await query(
    `SELECT a.supplier_id, s.vault_namespace
       FROM applications a LEFT JOIN suppliers s ON s.id = a.supplier_id
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null; // null = application doesn't exist
}

// PATCH /api/v1/applications/:id
// Prompt 19 — this route had NO authorization check of any kind (neither
// role nor tenant): any authenticated session could patch any application's
// registry row, cross-tenant, regardless of persona. Closed the same way
// Phase 18 closed GET /applications/:id.
applicationsRouter.patch("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const app = await applicationTenant(req.params.id);
    if (!app) return next(notFound());

    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(app.supplier_id))
      return next(notFound());
    const decision = authorize({
      identity: req.identity,
      action: "provision",
      tenant: app.vault_namespace,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });

    const { description } = req.body ?? {};
    if (
      description !== undefined &&
      description !== null &&
      description.length > 512
    )
      return res
        .status(400)
        .json({ error: "description max 512 chars", field: "description" });

    const { rows } = await query(
      "UPDATE applications SET description = $1 WHERE id = $2 RETURNING id, name, description, registered_at",
      [description ?? null, req.params.id],
    );
    if (!rows.length) return next(notFound());
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/applications/:id
// Prompt 19 — same gap as PATCH above: no authorization check at all
// previously. Deleting one application (unlike deleting a whole supplier)
// stays within the matrix's ordinary "limited" destroy_request semantics —
// a supplier-admin may delete their own tenant's application, not
// arbitrary ones.
applicationsRouter.delete("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const app = await applicationTenant(req.params.id);
    if (!app) return next(notFound());

    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(app.supplier_id))
      return next(notFound());
    const decision = authorize({
      identity: req.identity,
      action: "destroy_request",
      tenant: app.vault_namespace,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "destroy_request",
        reason: decision.reason,
      });

    const { rowCount } = await query("DELETE FROM applications WHERE id = $1", [
      req.params.id,
    ]);
    if (!rowCount) return next(notFound());
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/applications/:id/provision — Prompt 14.2
// Body: { custody?: "vault"|"softhsm", key_type?, capabilities?: string[], rotation_days? }
// Arcanium creates the workload AppRole + least-privilege policy + Transit key.
applicationsRouter.post("/:id/provision", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const { rows } = await query(
      "SELECT id, name, supplier_id FROM applications WHERE id = $1",
      [req.params.id],
    );
    if (!rows.length) return next(notFound());
    const app = rows[0];

    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(app.supplier_id)) {
      return res.status(403).json({ error: "not your tenant's application" });
    }
    // Role check (Prompt 18) — the tenantScope check above only enforces the
    // TENANT boundary for supplier-admins; it says nothing about whether the
    // caller's ROLE may provision at all (ciso/auditor previously could).
    // Prompt 19 — this call never passed `tenant`, so authorize()'s "limited"
    // (supplier-admin) verdict always denied, even for the caller's own
    // tenant's application — the same missing-tenant-param bug already fixed
    // in POST / and PATCH/DELETE /:id above. Resolve the same way.
    const tenantInfo = await applicationTenant(req.params.id);
    const decision = authorize({
      identity: req.identity,
      action: "provision",
      tenant: tenantInfo?.vault_namespace ?? null,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });

    const body = req.body ?? {};
    const params = {
      custody: body.custody === "softhsm" ? "softhsm" : "vault",
      key_type: body.key_type,
      capabilities: body.capabilities,
      rotation_days: Number(body.rotation_days) || null,
      tls: !!body.tls,
    };
    const job = await createJob({
      target_type: "application",
      target_id: app.id,
      target_name: app.name,
      action: "provision",
      requested_by: req.identity?.user ?? "arcanium",
      params,
    });
    const finished = await runOrQueue(job, (j) =>
      provisionApplication(j, app, params),
    );
    res
      .status(finished.queued || finished.status === "succeeded" ? 202 : 502)
      .json({ application: app, provisioning_job: finished });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/applications/:id/classify — Prompt 17
// Body: { category: "platform" | "tenant" | "unscoped" }
// Marks the application's governance classification. "platform" = Arcanium-owned
// root-namespace workload; "tenant" = supplier-scoped; "unscoped" = not yet classified.
applicationsRouter.post("/:id/classify", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const { category } = req.body ?? {};
    const VALID = ["platform", "tenant", "unscoped"];
    if (!VALID.includes(category))
      return res.status(400).json({
        error: `category must be one of: ${VALID.join(", ")}`,
        field: "category",
      });

    // "tenant" requires a supplier_id on the app.
    if (category === "tenant") {
      const { rows: check } = await query(
        "SELECT supplier_id FROM applications WHERE id = $1",
        [req.params.id],
      );
      if (!check.length) return next(notFound());
      if (!check[0].supplier_id)
        return res.status(400).json({
          error:
            "category 'tenant' requires the application to be bound to a supplier first",
          field: "category",
        });
    }

    const { rows } = await query(
      "UPDATE applications SET category = $1 WHERE id = $2 RETURNING id, name, category, supplier_id, registered_at",
      [category, req.params.id],
    );
    if (!rows.length) return next(notFound());

    // Record lifecycle event.
    await query(
      `INSERT INTO lifecycle_events (resource_type, resource_id, event, detail, source)
       VALUES ('application', $1, 'category.set', $2, 'local')`,
      [req.params.id, JSON.stringify({ category })],
    ).catch(() => {});

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});
