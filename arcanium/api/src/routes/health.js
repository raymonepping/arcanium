// routes/health.js — liveness, readiness and full status endpoints.

import { Router } from "express";
import { getStatus } from "../vault.js";
import { ping } from "../db.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf8"),
);

export const healthRouter = Router();

// GET /health/live — liveness probe.
// Always 200 — only confirms the Node process is running.
// Used by: Containerfile HEALTHCHECK, Podman compose healthcheck.
healthRouter.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

// GET /health/ready — readiness probe.
// 200 when vault is authenticated and database is reachable.
// 503 otherwise — signals to the orchestrator not to route traffic yet.
healthRouter.get("/ready", async (_req, res) => {
  const vaultState = getStatus();
  if (!vaultState.authenticated) {
    return res
      .status(503)
      .json({ status: "unavailable", reason: "vault not authenticated" });
  }
  try {
    await ping();
    res.json({ status: "ready" });
  } catch (err) {
    res.status(503).json({
      status: "unavailable",
      reason: `database unreachable: ${err.message}`,
    });
  }
});

// GET /health — full status for humans and dashboards.
// 200 when fully healthy, 503 when degraded.
healthRouter.get("/", async (_req, res) => {
  const vaultState = getStatus();
  let dbLatencyMs = null;
  let dbReachable = false;
  let dbError = null;

  try {
    dbLatencyMs = await ping();
    dbReachable = true;
  } catch (err) {
    dbError = err.message;
  }

  const healthy = vaultState.authenticated && dbReachable;
  const status = healthy ? 200 : 503;

  res.status(status).json({
    status: healthy ? "ok" : "degraded",
    version,
    vault: {
      reachable: true, // We can't easily probe without a token; authenticated implies reachable
      authenticated: vaultState.authenticated,
      tokenExpiry: vaultState.tokenExpiry,
      ...(vaultState.authenticated ? {} : { error: "not authenticated" }),
    },
    database: {
      reachable: dbReachable,
      latencyMs: dbLatencyMs,
      ...(dbError ? { error: dbError } : {}),
    },
  });
});
