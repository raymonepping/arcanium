// routes/observability.js — Prompt 13 — compact operational summary for the UI.
// Proxies a handful of PromQL queries to Prometheus server-side; the browser
// never talks to Prometheus.

import { Router } from "express";

export const observabilityRouter = Router();

const PROM = (process.env.PROMETHEUS_URL || "http://prometheus:9090").replace(
  /\/$/,
  "",
);

async function q(expr) {
  try {
    const r = await fetch(
      `${PROM}/api/v1/query?query=${encodeURIComponent(expr)}`,
      {
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.data?.result?.[0]?.value?.[1];
    return v === undefined ? null : Number(v);
  } catch {
    return null;
  }
}

// GET /api/v1/observability/health
observabilityRouter.get("/health", async (_req, res) => {
  try {
    const r = await fetch(`${PROM}/-/healthy`, {
      signal: AbortSignal.timeout(3000),
    });
    res.json({ prometheus: r.ok, url: PROM });
  } catch {
    res.json({ prometheus: false, url: PROM });
  }
});

// GET /api/v1/observability/summary
observabilityRouter.get("/summary", async (_req, res) => {
  const [reqRate, errRate, p99, cryptoRate, vaultUp] = await Promise.all([
    q(`sum(rate(arcanium_http_requests_total[5m]))`),
    q(`sum(rate(arcanium_http_requests_total{status=~"5.."}[5m]))`),
    q(
      `histogram_quantile(0.99, sum by (le) (rate(arcanium_http_request_duration_seconds_bucket[5m])))`,
    ),
    q(`sum(rate(arcanium_crypto_operations_total[5m]))`),
    q(`count(up{job="vault"} == 1)`),
  ]);

  const available = [reqRate, errRate, p99, vaultUp].some((v) => v !== null);
  res.json({
    available,
    prometheus_url: PROM,
    metrics: {
      request_rate_per_s: reqRate,
      error_rate_per_s: errRate,
      p99_latency_s: p99,
      crypto_ops_per_s: cryptoRate,
      vault_nodes_up: vaultUp,
    },
    note: available
      ? null
      : "Observability stack not reachable. Run `make observability-up`.",
  });
});
