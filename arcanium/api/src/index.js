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

  app.use(express.json({ limit: "100kb" }));
  app.use(metricsMiddleware);
  app.use(requestLogger);

  app.get("/metrics", metricsHandler); // Prometheus scrape — no auth (bind localhost in compose)
  app.use("/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
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
  app.use("/api/v1/observability", observabilityRouter);
  app.use("/api/v1/maturity", maturityRouter);

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
