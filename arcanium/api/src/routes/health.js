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
  // Prompt 29 — catch a wedged rotation BEFORE the credential actually
  // expires, not only after ping() starts failing. Prompt 30: under
  // Vault-Agent-managed rotation, "expiry imminent" is sufficient on its
  // own — arcanium-vault-agent's own auth/render retry state is not
  // observable from this process (by design, see vault.js's own header),
  // so requiring a paired lastDbRotationError here (Prompt 29's original
  // condition) would never fire under this architecture even when
  // genuinely stale. If Agent is doing its job the file refreshes well
  // before expiry; imminent expiry alone already means it hasn't.
  const expirySoon =
    vaultState.dbCredsExpiry &&
    new Date(vaultState.dbCredsExpiry).getTime() - Date.now() < 60_000;
  if (expirySoon) {
    return res.status(503).json({
      status: "unavailable",
      reason: "db credential expires soon with no fresher render observed",
      dbCredsExpiry: vaultState.dbCredsExpiry,
      ...(vaultState.lastDbRotationError
        ? { lastDbRotationError: vaultState.lastDbRotationError }
        : {}),
    });
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
      // Prompt 30 — makes the Vault Agent architecture change visible in
      // this response itself, not silently identical-looking JSON from a
      // totally different underlying mechanism.
      agentManaged: vaultState.agentManaged ?? false,
      lastTokenRefreshAt: vaultState.lastTokenRefreshAt,
      ...(vaultState.lastTokenRefreshError
        ? { lastTokenRefreshError: vaultState.lastTokenRefreshError }
        : {}),
      ...(vaultState.authenticated ? {} : { error: "not authenticated" }),
    },
    database: {
      reachable: dbReachable,
      latencyMs: dbLatencyMs,
      dbCredsExpiry: vaultState.dbCredsExpiry,
      lastDbRotationAt: vaultState.lastDbRotationAt,
      ...(vaultState.lastDbRotationError
        ? { lastDbRotationError: vaultState.lastDbRotationError }
        : {}),
      ...(dbError ? { error: dbError } : {}),
    },
  });
});
