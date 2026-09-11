# Service Level Objectives

Prompt 24, Deliverable 1. Every SLO here is measured from real telemetry, never asserted. A percentage without a window and a minimum sample size is fake precision — one successful request is never reportable as "100% availability." Below its minimum sample count, an SLO's status is `INSUFFICIENT_DATA`, and its `value` field is omitted entirely, never computed-but-hidden.

**Live:** `GET /api/v1/observability/slo` (also rendered as a foldable panel on the [Observability page](../arcanium/ui/app/pages/observability.vue), collapsed by default, matching the Dashboard's own card convention).

## Targets

| SLO | Target | Window | Min samples |
|---|---|---|---|
| Provision success rate | ≥ 99.9% | rolling 7d | 20 |
| P95 provision latency | < 30s | rolling 24h | 20 |
| API availability | ≥ 99.95% | rolling 24h | 500 requests |
| Evidence ingestion lag | < 60s | rolling 1h | 10 |
| Drift detection interval | < 5 min | rolling 24h | 10 reconciliation runs |
| Stuck job age | < 10 min | instantaneous | none — a stuck job is a stuck job |
| Vault dependency health | 100% (binary per sample, rate over the window) | rolling 15 min | 3 health checks |

## Response shape

```json
{ "name": "api_availability", "window": "24h", "samples": 342,
  "min_samples": 500, "status": "INSUFFICIENT_DATA" }
```

```json
{ "name": "api_availability", "window": "24h", "samples": 611,
  "min_samples": 500, "value": 0.9997, "target": 0.9995, "status": "MET" }
```

`status` is one of `MET`, `BREACHED`, `INSUFFICIENT_DATA` — never a bare number, never inferred from a green icon alone.

## Two data sources, deliberately not one

`arcanium/api/src/telemetry/slo.js` computes each SLO from whichever source actually holds the real history for it — round-tripping everything through one mechanism would either lose precision or duplicate data that already exists correctly elsewhere:

- **Rate/latency SLOs** (provision success rate, P95 provision latency, API availability) query **Prometheus** via PromQL range vectors (`increase()`, `histogram_quantile()`). Prometheus already retains the rolling-window history these need (`compose/observability/prometheus/prometheus.yml`, Prompt 13's scrape config) — reimplementing rate/quantile math over raw Postgres rows would just be a worse copy of what Prometheus already does.
- **Event-gap SLOs** (evidence ingestion lag, drift detection interval, stuck job age) query **PostgreSQL** directly — these are timestamp deltas over rows (`evidence.ts` vs `evidence.created_at`, consecutive `reconciliation_runs.created_at`, `provisioning_jobs.updated_at`) that already carry real timestamps. A new Prometheus histogram fed by an app-level `observe()` call would only add a second, laggier copy of data Postgres already has exactly.
- **Vault dependency health** has no natural home in either, because nothing previously *polled* Vault/DB health on a schedule — only the container's own `/health/live` liveness probe runs periodically (every 15s, Containerfile `HEALTHCHECK`), and it never touches Vault or the database (confirmed by reading `routes/health.js` before assuming otherwise). `telemetry/slo.js` adds a small in-process poller (`startVaultHealthPoll()`, called once from `index.js` at startup, 60s cadence) that samples `getStatus().authenticated` + a real `ping()` into a 15-minute in-memory ring buffer — independent of whatever external traffic happens to hit the API.

## New metrics this prompt actually wires up

`jobEvent()` and `approvalEvent()` existed in `telemetry/metrics.js` since Prompt 13 but were **never called anywhere** — found while implementing this prompt, not assumed. Without them, `arcanium_provisioning_jobs_total`/`arcanium_approvals_total` were dead metrics and the "Provision success rate" SLO would have had zero real data to compute from regardless of how correct the PromQL was. Fixed:

- `provisioner/steps.js`'s `setStatus()` choke point now calls `jobEvent(job.action, job.status)` on every terminal transition (`succeeded`/`failed`/`rolled_back`), plus a new `arcanium_provision_duration_seconds` histogram (start-of-`running` to terminal) feeding the P95 latency SLO.
- `routes/approvals.js`'s three approve/deny/authorize-alias handlers now call `approvalEvent()`.

## `vault_request_id`: verified absent, not built

Deliverable 2 (`docs/correlation-ids.md`) asks for `vault_request_id` "from Vault's response headers where present." Checked live against the running cluster rather than assumed:

```
curl -sk -D - -o /dev/null https://127.0.0.1:18200/v1/sys/health
```

returns no `X-Vault-Request-Id`-shaped header at all on this Vault Enterprise 2.1.0 deployment. `vaultRequest()` (`arcanium/api/src/vault.js`) also currently discards response headers entirely, resolving only the parsed body. Building extraction code for a header this deployment never sends would be dead code presented as a working feature — not done. If a future Vault version or configuration starts sending one, `vaultRequest()`'s resolve path is the place to capture it.

## What this deliverable does not claim

No SLO here is presented as met until its own minimum sample count is satisfied by real traffic. On a freshly bootstrapped or recently-restarted lab, most or all of these will correctly show `INSUFFICIENT_DATA` — that is the honest state, not a bug to paper over by lowering the minimums or backfilling synthetic samples.
