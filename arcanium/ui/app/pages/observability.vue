<template>
  <div class="obs">
    <section class="arc-hero obs-hero">
      <div>
        <p class="hero-eyebrow">Operational evidence</p>
        <h2 class="hero-title">Observability</h2>
        <p class="hero-sub">
          Live platform telemetry — request rate, latency, error rate and crypto
          operation rate — served by the Arcanium API from Prometheus. The full
          dashboards are in Grafana.
        </p>
      </div>
      <a class="grafana-link" :href="grafanaUrl" target="_blank" rel="noopener noreferrer">
        Open Grafana ↗
      </a>
    </section>

    <div v-if="loading" class="state"><div class="spinner" /><span>Querying telemetry…</span></div>

    <template v-else-if="summary?.available">
      <div class="kpi-row">
        <div class="tile">
          <span class="tile-label">Request rate</span>
          <span class="tile-value">{{ fmt(summary.metrics.request_rate_per_s) }}<span class="unit">/s</span></span>
        </div>
        <div class="tile">
          <span class="tile-label">p99 latency</span>
          <span class="tile-value">{{ fmtMs(summary.metrics.p99_latency_s) }}<span class="unit">ms</span></span>
        </div>
        <div class="tile" :class="{ warn: (summary.metrics.error_rate_per_s ?? 0) > 0 }">
          <span class="tile-label">Error rate</span>
          <span class="tile-value">{{ fmt(summary.metrics.error_rate_per_s ?? 0) }}<span class="unit">/s</span></span>
        </div>
        <div class="tile">
          <span class="tile-label">Crypto ops</span>
          <span class="tile-value">{{ fmt(summary.metrics.crypto_ops_per_s ?? 0) }}<span class="unit">/s</span></span>
        </div>
        <div class="tile">
          <span class="tile-label">Vault nodes up</span>
          <span class="tile-value">{{ summary.metrics.vault_nodes_up ?? '—' }}<span class="unit">/3</span></span>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">What is collected</div>
        <ul class="collect">
          <li><strong>Vault</strong> — per-node request rate, latency, seal &amp; HA state (Prometheus scrapes <code>/v1/sys/metrics</code>)</li>
          <li><strong>Arcanium API</strong> — HTTP rate/latency/errors, crypto-operation counters, approval throughput, provisioning-job outcomes (OTLP + <code>/metrics</code>)</li>
          <li><strong>SLA</strong> — simulated contract vs the real per-namespace rate-limit quota vs measured throughput (Grafana dashboard)</li>
        </ul>
        <p class="collect-note">
          The API never sees workload plaintext, so workload → Vault crypto traffic
          is derived on the dashboard from Vault's own <code>vault_core_handle_request_count</code>,
          shown alongside "via Arcanium" operations.
        </p>
      </div>
    </template>

    <div v-else class="panel upcoming">
      <div class="panel-title">Observability stack not connected</div>
      <p>
        The monitoring stack (Prometheus, Grafana, OpenTelemetry Collector) is deployed
        separately. Start it and this page fills with live data.
      </p>
      <code class="cmd">make observability-up</code>
      <p class="collect-note">{{ summary?.note }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

definePageMeta({ layout: 'default' })
useHead({ title: 'Observability' })

const loading = ref(true)
const summary = ref<any>(null)
const grafanaUrl = 'http://localhost:3010'

function fmt(n: number | null) { return n == null ? '—' : n.toFixed(2) }
function fmtMs(n: number | null) { return n == null ? '—' : Math.round(n * 1000) }

async function load() {
  try {
    summary.value = await $fetch<any>('/gateway/api/v1/observability/summary')
  } catch {
    summary.value = { available: false, note: 'Telemetry endpoint unreachable.' }
  } finally {
    loading.value = false
  }
}
onMounted(load)
usePolling(load, 15000)
</script>

<style scoped>
.obs { display: flex; flex-direction: column; gap: 18px; }
.obs-hero { display: flex; gap: 28px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 520px; margin: 0; }
.grafana-link { font-size: 12px; color: var(--arc-action-bright); border: 1px solid var(--arc-glass-border); border-radius: 100px; padding: 7px 14px; text-decoration: none; white-space: nowrap; }
.grafana-link:hover { border-color: rgba(0,180,216,0.4); }

.state { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 60px; color: var(--arc-text-muted); font-size: 13px; }
.spinner { width: 22px; height: 22px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
@media (max-width: 900px) { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
.tile { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; }
.tile.warn { border-color: rgba(220,47,2,0.3); }
.tile-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--arc-text-muted); }
.tile-value { font-size: 26px; font-weight: 750; color: var(--arc-text-primary); font-variant-numeric: tabular-nums; }
.tile .unit { font-size: 13px; color: var(--arc-text-muted); margin-left: 3px; }
.tile.warn .tile-value { color: var(--arc-critical); }

.panel { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 12px; padding: 18px 20px; }
.panel.upcoming { text-align: center; padding: 40px; }
.panel-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--arc-text-muted); margin-bottom: 10px; }
.collect { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--arc-text-secondary); line-height: 1.8; }
.collect code, .cmd { font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--arc-action-bright); }
.collect-note { font-size: 11px; color: var(--arc-text-dim); line-height: 1.6; margin: 10px 0 0; }
.cmd { display: inline-block; margin: 12px 0; padding: 8px 14px; background: rgba(0,8,24,0.5); border: 1px solid var(--arc-glass-border); border-radius: 8px; }
</style>
