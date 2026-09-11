// index.js — Express application entry point.
// Startup is fail-fast: any error before server.listen exits with code 1.

import express from "express";
import { createServer } from "node:http";

import config from "./config.js";
import { init as vaultInit, getDbCredentials } from "./vault.js";
import { init as dbInit } from "./db.js";
import { runMigrations } from "./migrations.js";

import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { healthRouter } from "./routes/health.js";
import { applicationsRouter } from "./routes/applications.js";
import { keysRouter } from "./routes/keys.js";
import { pkiRouter } from "./routes/pki.js";
import { suppliersRouter } from "./routes/suppliers.js";
import { approvalsRouter } from "./routes/approvals.js";
import { clusterRouter } from "./routes/cluster.js";
import { jobsRouter } from "./routes/jobs.js";
import { platformRouter } from "./routes/platform.js";
import { keymgmtRouter } from "./routes/keymgmt.js";
import { integrationsRouter } from "./routes/integrations.js";
import { evidenceRouter } from "./routes/evidence.js";
import { reconciliationRouter } from "./routes/reconciliation.js";
import { controlsRouter } from "./routes/controls.js";
import { authRouter, requireSession } from "./auth/index.js";
import { observabilityRouter } from "./routes/observability.js";
import { metricsMiddleware, metricsHandler } from "./telemetry/metrics.js";
import { maturityRouter } from "./maturity/report.js";

async function main() {
  // 1. Vault: AppRole login + first DB credentials
  console.log("[startup] initialising Vault client...");
  await vaultInit();

  // 2. Database pool: init with credentials from Vault
  console.log("[startup] initialising database pool...");
  const { username, password } = getDbCredentials();
  dbInit(username, password);

  // 3. Migrations
  console.log("[startup] running migrations...");
  await runMigrations();

  // 4. Build Express app
  const app = express();
  app.set("trust proxy", false);
  app.disable("x-powered-by");

  app.use(securityHeaders);
  app.use(express.json({ limit: "100kb" }));
  app.use(metricsMiddleware);
  app.use(requestLogger);

  app.get("/metrics", metricsHandler); // Prometheus scrape — no auth (bind localhost in compose)
  app.use("/health", healthRouter);
  app.use("/api/v1/auth", authRouter);

  // Prompt 23 — /api-docs is a browser-navigated page (not a fetch target).
  // When auth is enabled and the request arrives without a valid session cookie,
  // redirect to the login flow instead of returning a bare JSON 401. On return
  // from Keycloak the browser will land back at /api-docs via the `next` param.
  if (config.apiExplorerEnabled && config.nodeEnv !== "production") {
    app.use("/api-docs", (req, res, next) => {
      if (!config.auth.enabled) return next();
      const raw = req.headers.cookie || "";
      const hasCookie = raw
        .split(";")
        .some((p) => p.trim().startsWith("arc_session="));
      if (!hasCookie)
        return res.redirect(
          302,
          `/api/v1/auth/login?next=${encodeURIComponent("/api-docs")}`,
        );
      next();
    });
  }

  // Prompt 14.5 — no-op when ARCANIUM_AUTH_ENABLED is unset; enforces a session otherwise.
  app.use(requireSession);
  app.use("/api/v1/applications", applicationsRouter);
  app.use("/api/v1/keys", keysRouter);
  app.use("/api/v1/pki", pkiRouter);
  app.use("/api/v1/suppliers", suppliersRouter);
  app.use("/api/v1/approvals", approvalsRouter);
  app.use("/api/v1/cluster", clusterRouter);
  app.use("/api/v1/jobs", jobsRouter);
  app.use("/api/v1/platform", platformRouter);
  app.use("/api/v1/keymgmt", keymgmtRouter);
  app.use("/api/v1/integrations", integrationsRouter);
  app.use("/api/v1/evidence", evidenceRouter);
  app.use("/api/v1/reconciliation", reconciliationRouter);
  app.use("/api/v1/controls", controlsRouter);
  app.use("/api/v1/observability", observabilityRouter);
  app.use("/api/v1/maturity", maturityRouter);

  // Prompt 23 — API explorer (Scalar). Two conditions both required:
  //   1. ARCANIUM_API_EXPLORER_ENABLED=true  — explicit opt-in, default off
  //   2. NODE_ENV !== 'production'            — hard safety net
  // compose/arcanium/compose.yaml sets NODE_ENV=production unconditionally for
  // this container, so condition 2 is what keeps it off in the running stack by
  // default; condition 1 is what turns it on locally when the operator sets the
  // flag. Both must hold — neither alone is sufficient.
  // The Scalar UI bundle loads from cdn.jsdelivr.net in the developer's browser
  // at runtime (not a local bundle — see prompts/23_api_explorer.md Option A).
  if (config.apiExplorerEnabled && config.nodeEnv !== "production") {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { apiReference } = await import("@scalar/express-api-reference");

    const specPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../openapi/arcanium.yaml",
    );
    const spec = readFileSync(specPath, "utf8");

    app.use(
      "/api-docs",
      apiReference({
        spec: { content: spec },
        // Use the direct API server (servers[0] in openapi/arcanium.yaml),
        // not the Nuxt gateway — /api-docs is a backend-developer tool.
        servers: [{ url: "http://localhost:3001", description: "Direct API" }],
        // Do not inject a default auth value — the operator's browser cookie
        // (arc_session) is already in play when they open this in the same
        // browser profile they used to log into the Arcanium UI.
        authentication: { preferredSecurityScheme: "sessionCookie" },
      }),
    );

    console.log(
      "[startup] API explorer: http://localhost:3001/api-docs (ARCANIUM_API_EXPLORER_ENABLED=true)",
    );
  }

  // 404 for unknown routes
  app.use((_req, res) => res.status(404).json({ error: "not found" }));

  // Global error handler (must be last)
  app.use(errorHandler);

  // 5. Start listening
  const server = createServer(app);
  await new Promise((resolve) => server.listen(config.port, resolve));
  console.log(
    `[startup] arcanium-api listening on port ${config.port} (${config.nodeEnv})`,
  );

  // 6. Graceful shutdown
  function shutdown(signal) {
    console.log(`[shutdown] received ${signal}, draining connections...`);
    server.close(async () => {
      const { getPool } = await import("./db.js");
      const pool = getPool();
      if (pool) await pool.end().catch(() => {});
      console.log("[shutdown] clean exit");
      process.exit(0);
    });
    // Force exit if drain takes too long
    setTimeout(() => {
      console.error("[shutdown] timeout — forced exit");
      process.exit(1);
    }, 10000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[startup] fatal error:", err.message);
  process.exit(1);
});
