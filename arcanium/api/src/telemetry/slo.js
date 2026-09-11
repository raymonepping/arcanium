// telemetry/slo.js — Prompt 24, Deliverable 1.
//
// Every SLO here reports { name, window, samples, min_samples, status,
// value? } — never a bare percentage (input/36's rule: one successful
// request is never "100% availability"). status is INSUFFICIENT_DATA
// whenever samples < min_samples, MET when value satisfies the target,
// BREACHED otherwise. Below the minimum, value is omitted entirely —
// a computed-but-hidden number is still a lie by omission.
//
// Two real data sources, not one artificially forced into the other:
//   - Rate/latency SLOs (provision success, provision latency, API
//     availability) query Prometheus via PromQL range vectors — it already
//     retains the rolling-window history these need (prometheus.yml,
//     Prompt 13), and reinventing rate()/histogram_quantile() over raw
//     Postgres rows would just be a worse version of what Prometheus does.
//   - Event-gap SLOs (evidence ingestion lag, drift detection interval,
//     stuck job age) query Postgres directly — these are timestamp deltas
//     over rows that already carry real timestamps; round-tripping them
//     through a new Prometheus histogram would add a second, laggier copy
//     of data Postgres already has exactly.
//   - Vault dependency health has no natural home in either: nothing
//     previously polled /health/ready on a schedule (only the container's
//     own /health/live liveness check runs periodically, and it never
//     touches Vault/DB — confirmed by reading routes/health.js). A small
//     in-process poller (startVaultHealthPoll, called once from index.js)
//     is added below rather than assumed to already exist.

import { query } from "../db.js";
import { getStatus } from "../vault.js";
import { ping } from "../db.js";
import config from "../config.js";

const PROM = (process.env.PROMETHEUS_URL || "http://prometheus:9090").replace(
  /\/$/,
  "",
);

async function promQuery(expr) {
  try {
    const r = await fetch(
      `${PROM}/api/v1/query?query=${encodeURIComponent(expr)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.data?.result?.[0]?.value?.[1];
    return v === undefined || v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function shape({ name, window, min_samples, samples, value, target, meets }) {
  const base = { name, window, samples, min_samples };
  if (samples < min_samples) return { ...base, status: "INSUFFICIENT_DATA" };
  if (value === null)
    return { ...base, status: "INSUFFICIENT_DATA", detail: "no data returned" };
  return {
    ...base,
    value,
    target,
    status: meets(value) ? "MET" : "BREACHED",
  };
}

// ── Rate/latency SLOs (Prometheus) ──────────────────────────────────────────

async function provisionSuccessRate() {
  const window = "7d";
  const succeeded = await promQuery(
    `sum(increase(arcanium_provisioning_jobs_total{status="succeeded"}[${window}])) or vector(0)`,
  );
  const failed = await promQuery(
    `sum(increase(arcanium_provisioning_jobs_total{status=~"failed|rolled_back"}[${window}])) or vector(0)`,
  );
  const samples = Math.round((succeeded ?? 0) + (failed ?? 0));
  const value = samples > 0 ? (succeeded ?? 0) / samples : null;
  return shape({
    name: "provision_success_rate",
    window,
    min_samples: 20,
    samples,
    value,
    target: 0.999,
    meets: (v) => v >= 0.999,
  });
}

async function p95ProvisionLatency() {
  const window = "24h";
  const samples = Math.round(
    (await promQuery(
      `sum(increase(arcanium_provision_duration_seconds_count[${window}])) or vector(0)`,
    )) ?? 0,
  );
  const value = await promQuery(
    `histogram_quantile(0.95, sum by (le) (rate(arcanium_provision_duration_seconds_bucket[${window}])))`,
  );
  return shape({
    name: "p95_provision_latency_seconds",
    window,
    min_samples: 20,
    samples,
    value,
    target: 30,
    meets: (v) => v < 30,
  });
}

async function apiAvailability() {
  const window = "24h";
  const total = await promQuery(
    `sum(increase(arcanium_http_requests_total[${window}])) or vector(0)`,
  );
  const errors = await promQuery(
    `sum(increase(arcanium_http_requests_total{status=~"5.."}[${window}])) or vector(0)`,
  );
  const samples = Math.round(total ?? 0);
  const value = samples > 0 ? 1 - (errors ?? 0) / samples : null;
  return shape({
    name: "api_availability",
    window,
    min_samples: 500,
    samples,
    value,
    target: 0.9995,
    meets: (v) => v >= 0.9995,
  });
}

// ── Event-gap SLOs (Postgres) ───────────────────────────────────────────────

async function evidenceIngestionLag() {
  const window = "1h";
  const { rows } = await query(
    `SELECT count(*)::int AS n,
            avg(EXTRACT(EPOCH FROM (created_at - ts))) AS avg_lag_s
       FROM evidence
      WHERE created_at > now() - interval '1 hour'
        AND origin = 'audit-log'`,
  );
  const samples = rows[0]?.n ?? 0;
  const value = rows[0]?.avg_lag_s === null ? null : Number(rows[0].avg_lag_s);
  return shape({
    name: "evidence_ingestion_lag_seconds",
    window,
    min_samples: 10,
    samples,
    value,
    target: 60,
    meets: (v) => v < 60,
  });
}

async function driftDetectionInterval() {
  const window = "24h";
  // Gap between consecutive reconciliation runs, in seconds — the metric is
  // "how often is drift actually being checked", not any one run's own
  // duration. lag() needs at least 2 rows in the window to produce a gap;
  // samples counts the gaps produced, not the raw run rows.
  const { rows } = await query(
    `WITH runs AS (
       SELECT observed_at,
              observed_at - lag(observed_at) OVER (ORDER BY observed_at) AS gap
         FROM reconciliation_runs
        WHERE observed_at > now() - interval '24 hours'
     )
     SELECT count(gap)::int AS n, avg(EXTRACT(EPOCH FROM gap)) AS avg_gap_s
       FROM runs`,
  );
  const samples = rows[0]?.n ?? 0;
  const value = rows[0]?.avg_gap_s === null ? null : Number(rows[0].avg_gap_s);
  return shape({
    name: "drift_detection_interval_seconds",
    window,
    min_samples: 10,
    samples,
    value,
    target: 300,
    meets: (v) => v < 300,
  });
}

async function stuckJobAge() {
  // Instantaneous by design (prompts/24's own text: "a stuck job is a
  // stuck job") — no rolling window, no minimum sample count. samples here
  // is how many stuck jobs currently exist, not a statistical population.
  const { rows } = await query(
    `SELECT count(*)::int AS n,
            max(EXTRACT(EPOCH FROM (now() - updated_at))) AS max_age_s
       FROM provisioning_jobs
      WHERE status = 'running'
        AND updated_at < now() - interval '${config.stuckJobThresholdMinutes} minutes'`,
  );
  const stuckCount = rows[0]?.n ?? 0;
  const maxAge = rows[0]?.max_age_s === null ? null : Number(rows[0].max_age_s);
  return {
    name: "stuck_job_age_seconds",
    window: "instantaneous",
    samples: stuckCount,
    min_samples: 0,
    value: maxAge,
    target: config.stuckJobThresholdMinutes * 60,
    status: stuckCount === 0 ? "MET" : "BREACHED",
  };
}

// ── Vault dependency health (in-process poller) ─────────────────────────────

const HEALTH_WINDOW_MS = 15 * 60 * 1000;
const healthSamples = []; // { at: ms, healthy: bool }

async function pollVaultHealth() {
  let healthy = false;
  try {
    const vaultState = getStatus();
    if (vaultState.authenticated) {
      await ping();
      healthy = true;
    }
  } catch {
    healthy = false;
  }
  const now = Date.now();
  healthSamples.push({ at: now, healthy });
  while (healthSamples.length && now - healthSamples[0].at > HEALTH_WINDOW_MS) {
    healthSamples.shift();
  }
}

let pollTimer = null;
// Called once from index.js at startup. 60s cadence keeps well above the
// 3-sample minimum for a 15-minute window (up to 15 samples) without
// adding meaningful load — same order of magnitude as the container's own
// 15s liveness probe interval, just against the dependency this SLO
// actually cares about instead of a bare process-alive check.
export function startVaultHealthPoll(intervalMs = 60_000) {
  if (pollTimer) return;
  pollVaultHealth();
  pollTimer = setInterval(pollVaultHealth, intervalMs);
  pollTimer.unref?.();
}

function vaultDependencyHealth() {
  const now = Date.now();
  const inWindow = healthSamples.filter((s) => now - s.at <= HEALTH_WINDOW_MS);
  const samples = inWindow.length;
  const healthyCount = inWindow.filter((s) => s.healthy).length;
  const value = samples > 0 ? healthyCount / samples : null;
  return shape({
    name: "vault_dependency_health",
    window: "15m",
    min_samples: 3,
    samples,
    value,
    target: 1,
    meets: (v) => v === 1,
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function computeAllSlos() {
  const [
    provision_success_rate,
    p95_provision_latency,
    api_availability,
    evidence_ingestion_lag,
    drift_detection_interval,
    stuck_job_age,
    vault_dependency_health,
  ] = await Promise.all([
    provisionSuccessRate(),
    p95ProvisionLatency(),
    apiAvailability(),
    evidenceIngestionLag(),
    driftDetectionInterval(),
    Promise.resolve(stuckJobAge()),
    Promise.resolve(vaultDependencyHealth()),
  ]);
  return [
    provision_success_rate,
    p95_provision_latency,
    api_availability,
    evidence_ingestion_lag,
    drift_detection_interval,
    stuck_job_age,
    vault_dependency_health,
  ];
}
