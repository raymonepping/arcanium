// routes/applications.js — CRUD + runtime provisioning for registered applications.

import { Router } from "express";
import { query } from "../db.js";
import { createJob, runOrQueue } from "../provisioner/steps.js";
import { provisionApplication } from "../provisioner/application.js";
import { tenantScope } from "../auth/index.js";
import { authorize, roleVerdict } from "../auth/authorize.js";
import { teamReadScope, scopedReadDenied } from "../auth/scope.js";
import { getApplicationIntent } from "../aggregation/intent.js";

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
// Prompt 27, Deliverable 5/6 — team-scoped read (Configuration C): an
// identity with no estate-wide read role but a scoped grant like
// "arcanium-auditor:team:platform" sees exactly that team's applications —
// filtered, not a 403 ("read is allowed but scoped" per this prompt's own
// spec). Composed with, not replacing, the existing tenantScope() path.
applicationsRouter.get("/", async (req, res, next) => {
  try {
    const scope = await tenantScope(req);
    let supplierIdFilter = null; // null = unscoped (see everything)
    if (scope.scoped) {
      supplierIdFilter = scope.supplierIds;
    } else {
      const estateWideRead = (req.identity?.roles || []).some(
        (r) => roleVerdict(r, "read") === true,
      );
      if (!estateWideRead) {
        const team = await teamReadScope(req.identity);
        if (team.scoped) supplierIdFilter = team.supplierIds; // null here still means "this team covers everything"
      }
    }
    const { rows } =
      supplierIdFilter !== null
        ? await query(
            "SELECT id, name, description, supplier_id, category, environment, registered_at FROM applications WHERE supplier_id = ANY($1) ORDER BY registered_at DESC",
            [supplierIdFilter],
          )
        : await query(
            "SELECT id, name, description, supplier_id, category, environment, registered_at FROM applications ORDER BY registered_at DESC",
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
    // Prompt 27, Deliverable 3 — explicitly recorded, never silently
    // defaulted: an absent `environment` in the request body is set to
    // 'production' HERE (visible in this route's own code), not left to
    // the column's DB-level DEFAULT alone to paper over.
    const environment =
      req.body?.environment !== undefined && req.body?.environment !== null
        ? String(req.body.environment)
        : "production";
    if (!/^[a-z0-9_-]{1,64}$/i.test(environment))
      return res.status(400).json({
        error: "environment must match /^[a-z0-9_-]{1,64}$/i",
        field: "environment",
      });
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
    // Prompt 27, Deliverable 3 — the resource being created doesn't exist
    // yet, so its "env" is the environment being declared for it: a scoped
    // operator:env:staging grant may create staging applications but not
    // production ones.
    const decision = authorize({
      identity: req.identity,
      action: "provision",
      tenant,
      env: environment,
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
      "INSERT INTO applications (name, description, supplier_id, environment) VALUES ($1, $2, $3, $4) RETURNING id, name, description, supplier_id, environment, registered_at",
      [name, description ?? null, supplier_id ?? null, environment],
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
      "SELECT id, name, description, supplier_id, category, environment, registered_at FROM applications WHERE id = $1",
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
    // Prompt 27, Deliverable 5 — same fix, same reasoning, for the scoped
    // (team/env) grant path: GET / already narrows by it; a direct-by-id
    // fetch had not, until this audit found it.
    if (
      await scopedReadDenied(req.identity, {
        supplierId: apps[0].supplier_id,
        env: apps[0].environment,
      })
    ) {
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

// GET /api/v1/applications/:id/intent — Prompt 25.
// Pure read-model aggregation over Phases 18-21's existing tables/live
// reads — no new domain data. Tenant-scoped the same way GET /:id above is
// (404 on cross-tenant, not 403 — matches this file's own established
// convention rather than inventing a new one for this one route).
applicationsRouter.get("/:id/intent", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const { rows: apps } = await query(
      "SELECT id, supplier_id, environment FROM applications WHERE id = $1",
      [req.params.id],
    );
    if (!apps.length) return next(notFound());

    const scope = await tenantScope(req);
    if (scope.scoped && !scope.supplierIds.includes(apps[0].supplier_id)) {
      return next(notFound());
    }
    // Prompt 27, Deliverable 5 — same scoped-grant fix as GET /:id above.
    if (
      await scopedReadDenied(req.identity, {
        supplierId: apps[0].supplier_id,
        env: apps[0].environment,
      })
    ) {
      return next(notFound());
    }

    const intent = await getApplicationIntent(req.params.id);
    if (!intent) return next(notFound());

    // "Tenant isolation view" is a property of who's asking (a scoped
    // supplier-admin session), not of the application's own data — appended
    // here, at the route, rather than inside the data-only aggregation
    // module, which has no notion of a caller.
    const { _entryStoryLabels, ...body } = intent;
    const labels = [..._entryStoryLabels];
    if (scope.scoped) labels.push("Tenant isolation view");
    const summary = labels.length
      ? `This application's data currently supports: ${labels.join(", ")}.`
      : "Not enough data yet to characterize this application's story — no lifecycle, governance, or tenant-scoped session data present.";

    res.json({ ...body, entry_story: { labels, summary } });
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
    `SELECT a.supplier_id, a.environment, s.vault_namespace
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
      env: app.environment,
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
      env: app.environment,
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
      env: tenantInfo?.environment ?? null,
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
      // Prompt 20 — carried through to provisionApplication() so the
      // desired_state (rotation_period) seed it writes records who actually
      // requested this provisioning, under which OIDC groups.
      identity: {
        user: req.identity?.user ?? "arcanium",
        groups: req.identity?.groups ?? [],
      },
    };
    const job = await createJob({
      target_type: "application",
      target_id: app.id,
      target_name: app.name,
      action: "provision",
      requested_by: req.identity?.user ?? "arcanium",
      params,
      request_id: req.requestId,
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
// Prompt 22, Deliverable 4 — found live by the architecture fitness test's
// authorize()-coverage check: this route had no role or tenant check at
// all. Closed the same way PATCH /:id was (Prompt 19): tenantScope 404,
// then authorize('provision', tenant) — same governance weight as editing
// any other registry metadata field.
applicationsRouter.post("/:id/classify", async (req, res, next) => {
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
      env: app.environment,
    });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });

    const { category } = req.body ?? {};
    const VALID = ["platform", "tenant", "unscoped"];
    if (!VALID.includes(category))
      return res.status(400).json({
        error: `category must be one of: ${VALID.join(", ")}`,
        field: "category",
      });

    // "tenant" requires a supplier_id on the app (already fetched above).
    if (category === "tenant") {
      if (!app.supplier_id)
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
