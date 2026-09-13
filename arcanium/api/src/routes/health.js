// routes/health.js — liveness, readiness and full status endpoints.

import { Router } from "express";
import { getStatus, checkDbLeaseTtl } from "../vault.js";
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
  // expires, not only after ping() starts failing.
  // Prompt 42 — found live: the original check inferred expiry from a
  // locally-computed dbCredsExpiry (fileWriteTime + lease_duration),
  // which never updates while Agent silently renews the SAME lease in
  // place — the file only changes when a genuinely NEW credential is
  // issued. That made this fire on a credential that was, in Vault's own
  // real record, nowhere near expiring (confirmed live: arcanium-api sat
  // `unhealthy` for hours with a FailingStreak in the hundreds while
  // every actual query succeeded). checkDbLeaseTtl() asks Vault directly
  // for the lease's real remaining TTL, which correctly reflects Agent's
  // renewals since it's the same lease_id being renewed. A failed lease
  // check (Vault unreachable, or no lease_id captured yet) is "could not
  // verify," not "confirmed stale" — it falls through to ping(), the
  // actual, definitive check, rather than fabricating unhealthy from a
  // failed side-check.
  const lease = await checkDbLeaseTtl();
  const leaseExpiringSoon = lease.ttlSeconds !== null && lease.ttlSeconds < 60;
  // A rotation the API itself failed to pick up (Agent rendered a new
  // credential, but rotateCreds() threw) is a real, evidenced problem —
  // unlike the removed heuristic above, this is never fabricated: it's
  // only ever set from an actual caught error re-reading/rotating.
  if (leaseExpiringSoon || vaultState.lastDbRotationError) {
    return res.status(503).json({
      status: "unavailable",
      reason: leaseExpiringSoon
        ? "db credential lease has under 60s of real TTL remaining (live Vault lookup)"
        : "the last database credential rotation attempt failed",
      leaseTtlSeconds: lease.ttlSeconds,
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

  // Prompt 42 — the live Vault lease TTL, alongside the locally-computed
  // (and, per its own comment in vault.js, sometimes stale) dbCredsExpiry
  // estimate — a human comparing the two here can see the gap directly.
  const lease = await checkDbLeaseTtl();

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
      leaseTtlSeconds: lease.ttlSeconds,
      ...(lease.error ? { leaseCheckError: lease.error } : {}),
      lastDbRotationAt: vaultState.lastDbRotationAt,
      ...(vaultState.lastDbRotationError
        ? { lastDbRotationError: vaultState.lastDbRotationError }
        : {}),
      ...(dbError ? { error: dbError } : {}),
    },
    // Prompt 37 — makes evidence/ingest.js's own feature flag visible in
    // this response, the same way agentManaged (Prompt 30) made a
    // different architectural switch visible instead of silently
    // identical-looking JSON either way. Without this, "Use — Operation
    // evidence not yet ingested" on the key detail page is indistinguish-
    // able from "ingestion is disabled entirely for this deployment" —
    // two very different facts that look the same today.
    evidence: {
      ingestEnabled: process.env.EVIDENCE_INGEST_ENABLED === "true",
    },
  });
});
