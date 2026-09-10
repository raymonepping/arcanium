// telemetry/metrics.js — Prompt 13 — minimal Prometheus exposition, no deps.
//
// Counters and a latency histogram for the Arcanium API. Scraped at GET /metrics.
// OTLP export is optional and only wired when OTEL_ENABLED=true (see otel.js).

const counters = new Map(); // key: `name|label1=a,label2=b` -> number
const HIST_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const histograms = new Map(); // name|labels -> { buckets:[], sum, count }

function key(name, labels = {}) {
  const l = Object.entries(labels)
    .sort()
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "")}"`)
    .join(",");
  return l ? `${name}{${l}}` : name;
}

export function inc(name, labels = {}, by = 1) {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) || 0) + by);
}

export function observe(name, labels = {}, seconds = 0) {
  const k = key(name, labels);
  let h = histograms.get(k);
  if (!h) {
    h = { buckets: new Array(HIST_BUCKETS.length).fill(0), sum: 0, count: 0 };
    histograms.set(k, h);
  }
  h.sum += seconds;
  h.count += 1;
  for (let i = 0; i < HIST_BUCKETS.length; i++) {
    if (seconds <= HIST_BUCKETS[i]) h.buckets[i] += 1;
  }
}

// Express middleware: request counter + duration histogram.
export function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const route =
      (req.baseUrl || "") + (req.route?.path || req.path || "unknown");
    const norm = route.replace(/\/[0-9a-f-]{8,}/gi, "/:id");
    inc("arcanium_http_requests_total", {
      method: req.method,
      route: norm,
      status: res.statusCode,
    });
    const secs = Number(process.hrtime.bigint() - start) / 1e9;
    observe(
      "arcanium_http_request_duration_seconds",
      { method: req.method, route: norm },
      secs,
    );
  });
  next();
}

// GET /metrics
export function metricsHandler(_req, res) {
  const lines = [];
  lines.push("# TYPE arcanium_http_requests_total counter");
  for (const [k, v] of counters) lines.push(`${k} ${v}`);

  for (const [k, h] of histograms) {
    const base = k.replace(/\{.*\}$/, "");
    const labelInner = (k.match(/\{(.*)\}$/) || [, ""])[1];
    lines.push(`# TYPE ${base} histogram`);
    let cumulative = 0;
    for (let i = 0; i < HIST_BUCKETS.length; i++) {
      cumulative = h.buckets[i];
      const le = HIST_BUCKETS[i];
      lines.push(
        `${base}_bucket{${labelInner}${labelInner ? "," : ""}le="${le}"} ${cumulative}`,
      );
    }
    lines.push(
      `${base}_bucket{${labelInner}${labelInner ? "," : ""}le="+Inf"} ${h.count}`,
    );
    lines.push(`${base}_sum{${labelInner}} ${h.sum}`);
    lines.push(`${base}_count{${labelInner}} ${h.count}`);
  }
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.end(lines.join("\n") + "\n");
}

// Convenience helpers used by the routes.
export const cryptoOp = (op, key_, outcome = "ok") =>
  inc("arcanium_crypto_operations_total", { op, key: key_, outcome });
export const approvalEvent = (decision, source = "local") =>
  inc("arcanium_approvals_total", { decision, source });
export const jobEvent = (action, status) =>
  inc("arcanium_provisioning_jobs_total", { action, status });
