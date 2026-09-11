<template>
  <div class="mat">
    <section class="arc-hero mat-hero">
      <div>
        <p class="hero-eyebrow">Evidence-gated assessment</p>
        <h2 class="hero-title">Where the estate stands today</h2>
        <p class="hero-sub">
          Maturity is gated, not averaged — a single mandatory control at
          FAIL or UNKNOWN caps the level regardless of everything else.
          Coverage and Confidence are separate numbers: how much of the
          estate has evidence, and how strong that evidence is.
        </p>
      </div>
      <div v-if="report" class="mat-metrics">
        <div class="metric" :class="levelClass">
          <div class="metric-num">{{ report.maturity }}</div>
          <div class="metric-lab">{{ report.levelName }}</div>
        </div>
        <div class="metric" :class="coverageClass">
          <div class="metric-num">{{ report.coverage }}<span>%</span></div>
          <div class="metric-lab">Coverage</div>
        </div>
        <div class="metric" :class="confidenceClass">
          <div class="metric-num conf">{{ report.confidence }}</div>
          <div class="metric-lab">Confidence</div>
        </div>
      </div>
    </section>

    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Requesting maturity assessment…</span></div>
    <div v-else-if="error" class="coming-notice err">
      <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="4.5" x2="8" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/></svg>
      {{ error }}
    </div>

    <template v-else-if="report">
      <div class="ladder">
        <div
          v-for="l in ladder"
          :key="l.n"
          class="rung"
          :class="{ current: l.n === report.maturity, reached: l.n <= report.maturity }"
        >
          <span class="rung-n">{{ l.n }}</span>
          <span class="rung-name">{{ l.name }}</span>
        </div>
      </div>
      <p v-if="report.levelCapReason" class="cap-reason">
        <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="4.5" x2="8" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/></svg>
        {{ report.levelCapReason }}
      </p>

      <!-- Per-control evidence table — four distinct states, never a binary palette -->
      <div class="section-header">
        <h3 class="section-title">Controls <span class="card-title-sub">· {{ controlRows.length }} assessed</span></h3>
      </div>
      <div v-if="controlsLoading" class="row-loading">Loading control evidence…</div>
      <div v-else-if="!controlRows.length" class="row-empty">
        No control evidence visible to this session yet.
      </div>
      <div v-else class="table-wrap">
        <table class="arc-table">
          <thead>
            <tr>
              <th>Control</th><th>Scope</th><th>Status</th><th>Desired</th>
              <th>Observed</th><th>Freshness</th><th>Confidence</th><th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in controlRows" :key="a.id">
              <td>
                <span class="control-id mono">{{ a.control_id }}</span>
                <span v-if="a.mandatory" class="mandatory-tag">mandatory</span>
              </td>
              <td class="muted">{{ a.scope }}</td>
              <td><span class="status-pill" :class="pillClass(a.status)">{{ a.status }}</span></td>
              <td class="mono">{{ short(a.desired_value) }}</td>
              <td class="mono">{{ short(a.observed_value) }}</td>
              <td class="muted">{{ a.freshness_seconds != null ? rel(a.freshness_seconds) : '—' }}</td>
              <td><span class="conf-pill" :class="a.confidence">{{ a.confidence }}</span></td>
              <td>
                <NuxtLink
                  v-if="a.evidence_refs?.reconciliation_run_id"
                  :to="`/reconciliation/${a.evidence_refs.reconciliation_run_id}`"
                  class="ev-link"
                >reconciliation run →</NuxtLink>
                <span v-else class="muted ev-detail">{{ evidenceSummary(a.evidence_refs) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Prompt 17 dimensions — supplementary context, non-gating (Non-goals) -->
      <div class="dims-card">
        <button class="card-fold" :aria-expanded="showDims" @click="showDims = !showDims">
          <span class="fold-caret" :class="{ open: showDims }">▸</span>
          <h3 class="card-title">Signal dimensions <span class="card-title-sub">· supplementary, non-gating</span></h3>
        </button>
        <template v-if="showDims">
          <div class="dims">
            <div v-for="dim in report.dimensions" :key="dim.id" class="dim">
              <div class="dim-top">
                <span class="dim-name">{{ dim.name }}</span>
                <span class="dim-score" :class="dim.cls">{{ dim.score > 0 ? dim.score + '%' : 'No signal' }}</span>
              </div>
              <div class="dim-track">
                <div class="dim-fill" :class="dim.cls" :style="{ width: dim.score + '%' }" />
              </div>
              <div class="dim-basis">{{ dim.basis }}</div>
              <div v-if="dim.nextStep" class="dim-next">
                <svg viewBox="0 0 12 12" fill="none"><path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                {{ dim.nextStep }}
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="coming-notice">
        <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="4.5" x2="8" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/></svg>
        Every control traces to real evidence — a live Vault read, a Prompt 20
        reconciliation run, a Sentinel policy list, or a recorded hostile-scenario
        result. UNKNOWN means no usable evidence was gathered this run; it is
        never softened to FAIL or fabricated as PASS.
        <span v-if="report.generatedAt" class="gen">Generated {{ new Date(report.generatedAt).toLocaleString('en-GB') }}.</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { MaturityReport, ControlAssessment } from '~/types/arcanium'
import { apiErrorMessage, apiErrorStatus } from '~/utils/apiError'

definePageMeta({ layout: 'default' })
useHead({ title: 'Maturity' })

const { maturity, controls: fetchControls } = useArcaniumApi()
const loading = ref(true)
const error = ref('')
const report = ref<MaturityReport | null>(null)
const controlsLoading = ref(true)
const controlRows = ref<ControlAssessment[]>([])
const showDims = ref(false)

const ladder = [
  { n: 0, name: 'Unaware' }, { n: 1, name: 'Reactive' }, { n: 2, name: 'Defined' },
  { n: 3, name: 'Managed' }, { n: 4, name: 'Optimised' }, { n: 5, name: 'Governed' },
]
const levelClass = computed(() => {
  const l = report.value?.maturity ?? 0
  return l >= 4 ? 'high' : l >= 2 ? 'mid' : l >= 1 ? 'low' : 'none'
})
const coverageClass = computed(() => {
  const c = report.value?.coverage ?? 0
  return c >= 75 ? 'high' : c >= 45 ? 'mid' : c > 0 ? 'low' : 'none'
})
const confidenceClass = computed(() => {
  const c = report.value?.confidence
  return c === 'HIGH' ? 'high' : c === 'MEDIUM' ? 'mid' : 'low'
})

function pillClass(status: string) {
  return status.replace('/', '-')
}
function short(v: unknown) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (!entries.length) return '—'
    return entries.map(([k, val]) => `${k}: ${val}`).join(', ')
  }
  return String(v)
}
function evidenceSummary(refs: Record<string, unknown> | undefined) {
  if (!refs) return '—'
  if (refs.detail) return String(refs.detail)
  if (refs.method) return String(refs.method)
  if (refs.error) return `error: ${refs.error}`
  return Object.keys(refs).length ? JSON.stringify(refs) : '—'
}
function rel(seconds: number) {
  if (seconds < 60) return `${seconds}s ago`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

onMounted(async () => {
  try {
    report.value = await maturity()
  } catch (e: unknown) {
    error.value = apiErrorStatus(e) === 404
      ? 'The maturity assessment endpoint is not available on this API build.'
      : apiErrorMessage(e, 'Unable to load the maturity assessment.')
  } finally {
    loading.value = false
  }
  try {
    controlRows.value = await fetchControls()
  } catch { /* per-control detail is supplementary — headline already loaded */ } finally {
    controlsLoading.value = false
  }
})
</script>

<style scoped>
.mat { display: flex; flex-direction: column; gap: 18px; }
.mat-hero { display: flex; gap: 28px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 520px; margin: 0; }

.mat-metrics { display: flex; gap: 12px; }
.metric { text-align: center; padding: 14px 20px; border-radius: 14px; border: 1px solid var(--arc-glass-border); background: rgba(0, 8, 24, 0.4); min-width: 92px; }
.metric-num { font-size: 30px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; color: var(--arc-text-primary); }
.metric-num.conf { font-size: 16px; letter-spacing: 0.04em; }
.metric-num span { font-size: 15px; color: var(--arc-text-muted); }
.metric.high .metric-num { color: var(--arc-healthy); }
.metric.mid .metric-num { color: var(--arc-action-bright); }
.metric.low .metric-num { color: var(--arc-warning); }
.metric.none .metric-num { color: var(--arc-text-muted); }
.metric-lab { font-size: 10px; color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.07em; margin-top: 6px; }

.state-loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--arc-text-muted); font-size: 13px; }
.spinner { width: 24px; height: 24px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.ladder { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.rung { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 6px; border-radius: 10px; text-align: center; border: 1px solid var(--arc-border-subtle); background: rgba(4, 16, 38, 0.4); }
.rung-n { font-size: 13px; font-weight: 800; color: var(--arc-text-dim); }
.rung-name { font-size: 10px; color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.rung.reached { border-color: rgba(0, 119, 182, 0.3); }
.rung.reached .rung-n { color: var(--arc-action-bright); }
.rung.current { background: linear-gradient(180deg, rgba(0,119,182,0.2), rgba(0,119,182,0.05)); border-color: var(--arc-action-bright); }
.rung.current .rung-n, .rung.current .rung-name { color: var(--arc-text-primary); }

.cap-reason { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--arc-critical); background: var(--arc-critical-bg); border: 1px solid rgba(220,47,2,0.25); border-radius: 8px; padding: 8px 12px; margin: 0; }
.cap-reason svg { width: 14px; height: 14px; flex-shrink: 0; }

.section-header { display: flex; align-items: center; gap: 10px; }
.section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-primary); margin: 0; }
.card-title-sub { font-size: 11px; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--arc-text-muted); }
.row-loading, .row-empty { font-size: 12.5px; padding: 12px 0; color: var(--arc-text-muted); }

.table-wrap { border: 1px solid var(--arc-glass-border); border-radius: 12px; overflow: hidden; background: var(--arc-glass); overflow-x: auto; }
.arc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.arc-table th { text-align: left; padding: 9px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); background: rgba(0,8,24,0.4); border-bottom: 1px solid var(--arc-border-subtle); white-space: nowrap; }
.arc-table td { padding: 9px 12px; border-bottom: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.arc-table tr:last-child td { border-bottom: none; }
.control-id { font-weight: 700; }
.mandatory-tag { font-size: 8.5px; margin-left: 6px; padding: 1px 5px; border-radius: 3px; background: rgba(255,170,0,0.14); color: var(--arc-governance); text-transform: uppercase; letter-spacing: 0.04em; }
.mono { font-family: ui-monospace, monospace; font-size: 11px; color: var(--arc-action-bright); }
.muted { color: var(--arc-text-muted) !important; font-size: 11px; }
.ev-link { font-size: 11px; color: var(--arc-action-bright); text-decoration: none; }
.ev-link:hover { text-decoration: underline; }
.ev-detail { font-family: ui-monospace, monospace; }

.status-pill { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: 100px; letter-spacing: 0.03em; }
.status-pill.PASS { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.status-pill.FAIL { background: var(--arc-critical-bg); color: var(--arc-critical); }
.status-pill.UNKNOWN { background: var(--arc-pending-bg); color: var(--arc-governance); }
.status-pill.N-A { background: rgba(148,163,184,0.14); color: var(--arc-text-dim); }
.conf-pill { font-size: 9.5px; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; letter-spacing: 0.04em; }
.conf-pill.HIGH { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.conf-pill.MEDIUM { background: rgba(72,202,228,0.12); color: var(--arc-info); }
.conf-pill.LOW { background: rgba(148,163,184,0.14); color: var(--arc-text-muted); }

.dims-card { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 12px; padding: 14px 18px; }
.card-fold { display: flex; align-items: center; gap: 8px; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; font: inherit; color: inherit; width: 100%; text-align: left; }
.card-fold:hover .card-title, .card-fold:hover .fold-caret { color: var(--arc-action-bright); }
.fold-caret { font-size: 11px; color: var(--arc-text-muted); transition: transform 0.15s, color 0.15s; display: inline-block; }
.fold-caret.open { transform: rotate(90deg); }
.dims { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
.dim { background: rgba(0,8,24,0.3); border: 1px solid var(--arc-border-subtle); border-radius: 10px; padding: 14px 16px; }
.dim-top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.dim-name { font-size: 13px; font-weight: 700; color: var(--arc-text-primary); }
.dim-score { font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
.dim-score.high { color: var(--arc-healthy); }
.dim-score.mid { color: var(--arc-action-bright); }
.dim-score.low { color: var(--arc-warning); }
.dim-score.none { color: var(--arc-text-muted); }
.dim-track { height: 8px; background: var(--arc-bg-neutral); border-radius: 4px; overflow: hidden; }
.dim-fill { height: 100%; border-radius: 4px; transition: width 0.8s cubic-bezier(0.2, 0.8, 0.2, 1); background: var(--arc-border-strong); }
.dim-fill.high { background: linear-gradient(90deg, #0077b6, #22c55e); }
.dim-fill.mid { background: var(--arc-grad-accent); }
.dim-fill.low { background: linear-gradient(90deg, #9d0208, #f48c06); }
.dim-basis { font-size: 11px; color: var(--arc-text-muted); margin-top: 8px; font-family: ui-monospace, monospace; line-height: 1.5; }
.dim-next { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--arc-action-bright); margin-top: 8px; }
.dim-next svg { width: 12px; height: 12px; flex-shrink: 0; }

.coming-notice { display: flex; align-items: flex-start; gap: 8px; padding: 14px 18px; background: rgba(255,255,255,0.02); border: 1px solid var(--arc-border-subtle); border-radius: 10px; font-size: 11.5px; color: var(--arc-text-muted); line-height: 1.6; }
.coming-notice.err { border-color: rgba(220,47,2,0.3); color: var(--arc-critical); }
.coming-notice svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 2px; }
.gen { color: var(--arc-text-dim); }

@media (max-width: 720px) { .ladder { grid-template-columns: repeat(3, 1fr); } }
</style>
