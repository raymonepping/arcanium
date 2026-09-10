<template>
  <div class="mat">
    <section class="arc-hero mat-hero">
      <div>
        <p class="hero-eyebrow">Cryptographic maturity</p>
        <h2 class="hero-title">Where the estate stands today</h2>
        <p class="hero-sub">
          Scored server-side by the Arcanium API across five dimensions, live from
          database and Vault signals plus workload crypto operations ingested from
          the Vault audit log. Each dimension shows the exact evidence it was
          derived from.
        </p>
      </div>
      <div v-if="report" class="mat-overall" :class="overallClass">
        <div class="mat-overall-num">{{ report.overall }}<span>%</span></div>
        <div class="mat-overall-lab">Level {{ report.level }} · {{ report.levelName }}</div>
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
          :class="{ current: l.n === report.level, reached: l.n <= report.level }"
        >
          <span class="rung-n">{{ l.n }}</span>
          <span class="rung-name">{{ l.name }}</span>
        </div>
      </div>

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

      <div v-if="report.checks?.length" class="checks">
        <div class="checks-title">Level ladder — discrete checks</div>
        <div v-for="c in report.checks" :key="c.id" class="check" :class="{ pass: c.passed }">
          <span class="check-ico">{{ c.passed ? '✓' : '·' }}</span>
          <span class="check-name">{{ c.name }}</span>
          <span class="check-lvl">L{{ c.level }}</span>
          <span class="check-ev">{{ c.evidence }}</span>
        </div>
      </div>

      <div class="coming-notice">
        <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="4.5" x2="8" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/></svg>
        Scores are computed from live platform state — Vault key metadata, tenant namespaces, approval
        records, Sentinel policy, and audit-log evidence. Prometheus / OTel / Grafana are deployed and
        collecting; time-series signals (operation-rate trends, rotation-age SLOs) are not yet folded
        into the score.
        <span v-if="report.generatedAt" class="gen">Generated {{ new Date(report.generatedAt).toLocaleString('en-GB') }}.</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { MaturityReport } from '~/types/arcanium'
import { apiErrorMessage, apiErrorStatus } from '~/utils/apiError'

definePageMeta({ layout: 'default' })
useHead({ title: 'Maturity' })

const { maturity } = useArcaniumApi()
const loading = ref(true)
const error = ref('')
const report = ref<MaturityReport | null>(null)

const ladder = [
  { n: 0, name: 'Unaware' }, { n: 1, name: 'Reactive' }, { n: 2, name: 'Defined' },
  { n: 3, name: 'Managed' }, { n: 4, name: 'Optimised' }, { n: 5, name: 'Governed' },
]
const overallClass = computed(() => {
  const o = report.value?.overall ?? 0
  if (o === 0) return 'none'
  if (o < 45) return 'low'
  if (o < 75) return 'mid'
  return 'high'
})

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
})
</script>

<style scoped>
.mat { display: flex; flex-direction: column; gap: 18px; }
.mat-hero { display: flex; gap: 28px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 520px; margin: 0; }
.mat-overall { text-align: center; padding: 16px 24px; border-radius: 14px; border: 1px solid var(--arc-glass-border); background: rgba(0, 8, 24, 0.4); }
.mat-overall-num { font-size: 40px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; color: var(--arc-text-primary); }
.mat-overall-num span { font-size: 18px; color: var(--arc-text-muted); }
.mat-overall.high .mat-overall-num { color: var(--arc-healthy); }
.mat-overall.mid .mat-overall-num { color: var(--arc-action-bright); }
.mat-overall.low .mat-overall-num { color: var(--arc-warning); }
.mat-overall-lab { font-size: 11px; color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.07em; margin-top: 6px; }

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

.dims { display: flex; flex-direction: column; gap: 12px; }
.dim { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 12px; padding: 16px 18px; }
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

.checks { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 12px; padding: 14px 18px; }
.checks-title { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--arc-text-muted); margin-bottom: 10px; }
.check { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 12px; color: var(--arc-text-muted); border-bottom: 1px solid var(--arc-border-subtle); }
.check:last-child { border-bottom: none; }
.check.pass { color: var(--arc-text-secondary); }
.check-ico { width: 14px; text-align: center; }
.check.pass .check-ico { color: var(--arc-healthy); }
.check-name { flex: 1; font-weight: 600; }
.check-lvl { font-size: 10px; color: var(--arc-text-dim); }
.check-ev { font-size: 10.5px; color: var(--arc-text-dim); font-family: ui-monospace, monospace; }

.coming-notice { display: flex; align-items: flex-start; gap: 8px; padding: 14px 18px; background: rgba(255,255,255,0.02); border: 1px solid var(--arc-border-subtle); border-radius: 10px; font-size: 11.5px; color: var(--arc-text-muted); line-height: 1.6; }
.coming-notice.err { border-color: rgba(220,47,2,0.3); color: var(--arc-critical); }
.coming-notice svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 2px; }
.gen { color: var(--arc-text-dim); }

@media (max-width: 720px) { .ladder { grid-template-columns: repeat(3, 1fr); } }
</style>
