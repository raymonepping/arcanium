<template>
  <div>
    <section class="arc-hero rc-hero">
      <div>
        <p class="hero-eyebrow">Desired vs. observed</p>
        <h2 class="hero-title">Reconciliation</h2>
        <p class="hero-sub">
          What Arcanium was asked to enforce, compared against a live read of
          what Vault actually has. Drift is never hidden — only ever
          COMPLIANT, DRIFTED, or UNKNOWN.
        </p>
      </div>
      <div class="rc-sum">
        <div class="ok"><span>{{ counts.COMPLIANT }}</span>compliant</div>
        <div class="drift"><span>{{ counts.DRIFTED }}</span>drifted</div>
        <div class="unk"><span>{{ counts.UNKNOWN }}</span>unknown</div>
      </div>
    </section>

    <div class="filter-bar">
      <input v-model="search" class="filter-input" placeholder="Filter by application or key…" type="search" />
      <select v-model="filterStatus" class="filter-select">
        <option value="">All statuses</option>
        <option value="COMPLIANT">Compliant</option>
        <option value="DRIFTED">Drifted</option>
        <option value="UNKNOWN">Unknown</option>
      </select>
      <select v-model="filterDisposition" class="filter-select">
        <option value="">All dispositions</option>
        <option value="OPEN">Open</option>
        <option value="EXCEPTION_ACCEPTED">Exception accepted</option>
        <option value="RECONCILED">Reconciled</option>
      </select>
      <button class="secondary-button" :disabled="running" @click="runAll">
        {{ running ? 'Running…' : 'Run reconciliation' }}
      </button>
      <span class="result-count">{{ filtered.length }} row{{ filtered.length !== 1 ? 's' : '' }}</span>
    </div>
    <p v-if="runMsg" class="inline-notice">{{ runMsg }}</p>

    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Loading reconciliation state…</span></div>
    <div v-else-if="error" class="state-error"><div class="error-icon">⚠</div><p>{{ error }}</p></div>
    <div v-else-if="!filtered.length" class="state-empty">
      <p class="empty-title">No matching rows</p>
      <p class="empty-sub">
        Desired state is seeded automatically when an application is
        provisioned with a rotation policy. Provision an application, or
        clear your filters.
      </p>
    </div>

    <div v-else class="table-wrap">
      <table class="arc-table">
        <thead>
          <tr>
            <th>Application</th><th>Tenant</th><th>Key</th><th>Desired</th>
            <th>Observed</th><th>Status</th><th>Disposition</th><th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in paginated" :key="r.desired_state_id"
            class="data-row" :class="{ clickable: r.latest_run }"
            @click="r.latest_run && navigateTo(`/reconciliation/${r.latest_run.id}`)"
          >
            <td>{{ r.application_name }}</td>
            <td class="muted">{{ r.tenant ?? '—' }}</td>
            <td class="mono">{{ r.key_name }}</td>
            <td>{{ r.desired_value?.days }}d</td>
            <td>{{ r.latest_run?.observed_value?.days ?? '—' }}{{ r.latest_run?.observed_value ? 'd' : '' }}</td>
            <td><span class="status-pill" :class="r.observation_status">{{ r.observation_status }}</span></td>
            <td><span class="disposition-pill" :class="r.disposition">{{ r.disposition.replace('_', ' ') }}</span></td>
            <td class="muted">{{ r.latest_run ? rel(r.latest_run.observed_at) : 'never run' }}</td>
          </tr>
        </tbody>
      </table>
      <RecordPagination v-model:page="page" :total="filtered.length" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { ReconciliationRow } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })
useHead({ title: 'Reconciliation' })

// Reconcile/accept-exception buttons live on the detail page, gated there —
// this list intentionally always shows the "Run reconciliation" button for
// every persona (matching how approvals.vue/applications/[id].vue already
// work: the API is the real gate, a denial surfaces inline as an error,
// rather than this page carrying its own copy of the authorization matrix
// that could drift out of sync with auth/authorize.js).
const { reconciliationList, runReconciliation } = useArcaniumApi()

const loading = ref(true)
const error = ref('')
const rows = ref<ReconciliationRow[]>([])
const search = ref('')
const filterStatus = ref('')
const filterDisposition = ref('')
const running = ref(false)
const runMsg = ref('')
const page = ref(1)

const counts = computed(() => ({
  COMPLIANT: rows.value.filter(r => r.observation_status === 'COMPLIANT').length,
  DRIFTED: rows.value.filter(r => r.observation_status === 'DRIFTED').length,
  UNKNOWN: rows.value.filter(r => r.observation_status === 'UNKNOWN').length,
}))

const filtered = computed(() => {
  let l = rows.value
  if (filterStatus.value) l = l.filter(r => r.observation_status === filterStatus.value)
  if (filterDisposition.value) l = l.filter(r => r.disposition === filterDisposition.value)
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    l = l.filter(r => [r.application_name, r.key_name].some(x => String(x || '').toLowerCase().includes(q)))
  }
  return l
})
const paginated = computed(() => filtered.value.slice((page.value - 1) * 12, page.value * 12))

function rel(ts: string) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

async function load() {
  try {
    rows.value = await reconciliationList()
    error.value = ''
  } catch (e: unknown) {
    error.value = apiErrorMessage(e, 'Failed to load reconciliation state.')
  } finally {
    loading.value = false
  }
}

async function runAll() {
  if (running.value) return
  running.value = true
  runMsg.value = ''
  try {
    const results = await runReconciliation()
    const drifted = results.filter((r: any) => r.status === 'DRIFTED').length
    runMsg.value = `Swept ${results.length} desired-state row${results.length === 1 ? '' : 's'} — ${drifted} drifted.`
    await load()
  } catch (e: unknown) {
    runMsg.value = apiErrorMessage(e, 'Reconciliation sweep failed.')
  } finally {
    running.value = false
  }
}

onMounted(load)
usePolling(load, 20000)
</script>

<style scoped>
.rc-hero { display: flex; gap: 28px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 18px; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 480px; margin: 0; }
.rc-sum { display: flex; gap: 22px; }
.rc-sum div { display: flex; flex-direction: column; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); }
.rc-sum span { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
.rc-sum .ok span { color: var(--arc-healthy); }
.rc-sum .drift span { color: var(--arc-critical); }
.rc-sum .unk span { color: var(--arc-text-dim); }

.filter-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
.filter-input, .filter-select { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 8px; padding: 8px 12px; font-size: 13px; color: var(--arc-text-primary); font-family: inherit; outline: none; }
.filter-input { flex: 1; min-width: 200px; }
.result-count { font-size: 12px; color: var(--arc-text-muted); }

.state-loading, .state-empty, .state-error { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 10px; color: var(--arc-text-muted); text-align: center; }
.spinner { width: 26px; height: 26px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-icon { font-size: 24px; color: var(--arc-critical); }
.empty-title { font-size: 15px; font-weight: 700; color: var(--arc-text-secondary); margin: 0; }
.empty-sub { font-size: 12px; margin: 0; max-width: 420px; }

.table-wrap { border: 1px solid var(--arc-glass-border); border-radius: 12px; overflow: hidden; background: var(--arc-glass); }
.arc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.arc-table th { text-align: left; padding: 9px 14px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--arc-text-muted); background: rgba(0,8,24,0.4); border-bottom: 1px solid var(--arc-border-subtle); }
.arc-table td { padding: 10px 14px; border-bottom: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.arc-table tr:last-child td { border-bottom: none; }
.data-row.clickable { cursor: pointer; }
.data-row.clickable:hover td { background: rgba(255,255,255,0.02); }
.mono { font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--arc-action-bright); }
.muted { color: var(--arc-text-muted) !important; font-size: 11px; }

.status-pill { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: 100px; letter-spacing: 0.03em; }
.status-pill.COMPLIANT { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.status-pill.DRIFTED { background: var(--arc-critical-bg); color: var(--arc-critical); }
.status-pill.UNKNOWN { background: rgba(148,163,184,0.14); color: var(--arc-text-muted); }

.disposition-pill { font-size: 9.5px; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; letter-spacing: 0.04em; }
.disposition-pill.OPEN { background: rgba(148,163,184,0.12); color: var(--arc-text-muted); }
.disposition-pill.EXCEPTION_ACCEPTED { background: var(--arc-pending-bg); color: var(--arc-governance); }
.disposition-pill.RECONCILED { background: rgba(72,202,228,0.12); color: var(--arc-info); }

.inline-notice { font-size: 12px; color: var(--arc-action-bright); margin: 0 0 14px; padding: 8px 12px; background: rgba(0,119,182,0.08); border: 1px solid var(--arc-glass-border); border-radius: 8px; }
</style>
