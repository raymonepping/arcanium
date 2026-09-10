<template>
  <div>
    <section class="arc-hero ev-hero">
      <div>
        <p class="hero-eyebrow">One source of truth</p>
        <h2 class="hero-title">Evidence trail</h2>
        <p class="hero-sub">
          Workload cryptographic operations ingested from the Vault audit log,
          alongside governance decisions. What happened, who, through which path,
          against which tenant, what outcome.
        </p>
      </div>
      <div class="ev-sum">
        <div><span>{{ counts.audit }}</span>crypto ops</div>
        <div><span>{{ counts.approval }}</span>governance</div>
      </div>
    </section>

    <!-- KML lifecycle strip (Prompt 16.6) -->
    <div class="kml-strip" role="group" aria-label="Filter by key-management lifecycle stage">
      <button
        v-for="s in KML_STAGES" :key="s"
        class="kml-chip" :class="{ on: stageFilter === s, empty: !stageCounts[s] }"
        :aria-pressed="stageFilter === s"
        @click="stageFilter = stageFilter === s ? '' : s"
      >
        <span class="kml-name">{{ s }}</span>
        <span class="kml-n">{{ stageCounts[s] || '—' }}</span>
      </button>
    </div>

    <div class="filter-bar">
      <input v-model="search" class="filter-input" placeholder="Filter by operation, resource, actor…" type="search" />
      <select v-model="filterOrigin" class="filter-select">
        <option value="">All evidence</option>
        <option value="audit-log">Crypto operations</option>
        <option value="approval">Governance</option>
      </select>
      <select v-model="filterSource" class="filter-select">
        <option value="">All sources</option>
        <option value="manual">Manual</option>
        <option value="local">Local</option>
        <option value="external">External</option>
      </select>
      <span class="result-count">{{ filtered.length }} record{{ filtered.length !== 1 ? 's' : '' }}</span>
    </div>

    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Loading evidence…</span></div>
    <div v-else-if="!filtered.length" class="state-empty">
      <p class="empty-title">No matching evidence</p>
      <p class="empty-sub">
        Governance decisions always appear here. Crypto-operation evidence needs
        <code>EVIDENCE_INGEST_ENABLED</code> and the audit device mounted.
      </p>
    </div>

    <div v-else class="table-wrap">
      <table class="arc-table">
        <thead>
          <tr>
            <th>Stage</th><th>Operation</th><th>Resource</th><th>Actor</th><th>Source</th>
            <th>Tenant</th><th>Outcome</th><th>Origin</th><th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in paginated" :key="i" class="data-row">
            <td><span class="stage-tag" :class="r.lifecycle_stage">{{ r.lifecycle_stage }}</span></td>
            <td class="mono">{{ r.operation }}</td>
            <td class="mono">{{ r.resource_id }}</td>
            <td>{{ r.actor || '—' }}</td>
            <td><span class="source-pill" :class="r.source">{{ r.source }}</span></td>
            <td>{{ r.supplier || (r.namespace && r.namespace !== 'root' ? r.namespace : '—') }}</td>
            <td><span class="outcome" :class="r.outcome">{{ r.outcome }}</span></td>
            <td><span class="origin" :class="r.origin">{{ r.origin === 'audit-log' ? 'audit log' : 'approval' }}</span></td>
            <td class="muted">{{ rel(r.ts) }}</td>
          </tr>
        </tbody>
      </table>
      <RecordPagination v-model:page="page" :total="filtered.length" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useArcaniumApi } from '~/composables/useArcaniumApi'

definePageMeta({ layout: 'default' })
useHead({ title: 'Evidence Trail' })

const KML_STAGES = ['Generate', 'Distribute', 'Store', 'Use', 'Rotate', 'Destroy'] as const

const route = useRoute()
const router = useRouter()
const { evidenceTrail } = useArcaniumApi()
const loading = ref(true)
const rows = ref<any[]>([])
const serverStageCounts = ref<Record<string, number>>({})
const search = ref('')
const filterOrigin = ref('')
const filterSource = ref('')
const stageFilter = ref(typeof route.query.stage === 'string' && (KML_STAGES as readonly string[]).includes(route.query.stage) ? route.query.stage : '')
const page = ref(1)
const PER = 12

const counts = computed(() => ({
  audit: rows.value.filter(r => r.origin === 'audit-log').length,
  approval: rows.value.filter(r => r.origin === 'approval').length,
}))
const stageCounts = computed<Record<string, number>>(() => {
  const c: Record<string, number> = Object.fromEntries(KML_STAGES.map(s => [s, 0]))
  // Prefer the server tally (computed over a wider window than we display).
  for (const s of KML_STAGES) c[s] = serverStageCounts.value[s] ?? 0
  if (!Object.values(c).some(Boolean)) for (const r of rows.value) if (r.lifecycle_stage in c) c[r.lifecycle_stage]++
  return c
})

const filtered = computed(() => {
  let l = rows.value
  if (stageFilter.value) l = l.filter(r => r.lifecycle_stage === stageFilter.value)
  if (filterOrigin.value) l = l.filter(r => r.origin === filterOrigin.value)
  if (filterSource.value) l = l.filter(r => r.source === filterSource.value)
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    l = l.filter(r => [r.operation, r.resource_id, r.actor].some(x => String(x || '').toLowerCase().includes(q)))
  }
  return l
})
watch([search, filterOrigin, filterSource, stageFilter], () => { page.value = 1 })
watch(stageFilter, (s) => {
  router.replace({ query: s ? { ...route.query, stage: s } : { ...route.query, stage: undefined } })
})
const paginated = computed(() => filtered.value.slice((page.value - 1) * PER, page.value * PER))

function rel(ts: string) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

async function load() {
  try {
    const r = await evidenceTrail()
    rows.value = r.rows ?? []
    serverStageCounts.value = r.stage_counts ?? {}
  } catch { /* */ } finally { loading.value = false }
}
onMounted(load)
usePolling(load, 15000)
</script>

<style scoped>
.ev-hero { display: flex; gap: 28px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 18px; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 480px; margin: 0; }
.ev-sum { display: flex; gap: 22px; }
.ev-sum div { display: flex; flex-direction: column; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); }
.ev-sum span { font-size: 22px; font-weight: 800; color: var(--arc-text-primary); font-variant-numeric: tabular-nums; }

.filter-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
.filter-input, .filter-select { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 8px; padding: 8px 12px; font-size: 13px; color: var(--arc-text-primary); font-family: inherit; outline: none; }
.filter-input { flex: 1; min-width: 200px; }
.result-count { font-size: 12px; color: var(--arc-text-muted); }

.state-loading, .state-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 10px; color: var(--arc-text-muted); text-align: center; }
.spinner { width: 26px; height: 26px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.empty-title { font-size: 15px; font-weight: 700; color: var(--arc-text-secondary); margin: 0; }
.empty-sub { font-size: 12px; margin: 0; }
.empty-sub code { color: var(--arc-action-bright); font-family: ui-monospace, monospace; }

.table-wrap { border: 1px solid var(--arc-glass-border); border-radius: 12px; overflow: hidden; background: var(--arc-glass); }
.arc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.arc-table th { text-align: left; padding: 9px 14px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--arc-text-muted); background: rgba(0,8,24,0.4); border-bottom: 1px solid var(--arc-border-subtle); }
.arc-table td { padding: 10px 14px; border-bottom: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.arc-table tr:last-child td { border-bottom: none; }
.arc-table tbody tr:hover td { background: rgba(255,255,255,0.02); }
.mono { font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--arc-action-bright); }
.muted { color: var(--arc-text-muted) !important; font-size: 11px; }

.source-pill { font-size: 9.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.06em; }
.source-pill.manual { background: rgba(124,158,245,0.14); color: #9db6f7; }
.source-pill.local { background: rgba(72,202,228,0.12); color: var(--arc-info); }
.source-pill.external { background: var(--arc-pending-bg); color: var(--arc-governance); }
.outcome { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 100px; }
.outcome.ok { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.outcome.denied, .outcome.error { background: var(--arc-critical-bg); color: var(--arc-critical); }
.origin { font-size: 9.5px; color: var(--arc-text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
.origin.audit-log { color: var(--arc-info); }

/* KML lifecycle strip + per-row stage tag (Prompt 16.6) */
.kml-strip { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
.kml-chip { flex: 1; min-width: 120px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-radius: 9px; border: 1px solid var(--arc-glass-border); background: rgba(0,8,24,0.4); color: var(--arc-text-secondary); font-family: inherit; font-size: 11.5px; cursor: pointer; transition: border-color .14s, background .14s; }
.kml-chip:hover { border-color: var(--arc-action-primary); }
.kml-chip.on { border-color: var(--arc-action-bright); background: rgba(0,180,216,0.1); color: var(--arc-text-primary); }
.kml-chip.empty { opacity: 0.5; }
.kml-name { font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
.kml-n { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--arc-text-primary); }
.kml-chip.empty .kml-n { color: var(--arc-text-dim); font-weight: 600; }

.stage-tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 7px; border-radius: 4px; background: rgba(120,160,220,0.12); color: var(--arc-text-secondary); }
.stage-tag.Generate { background: rgba(72,202,228,0.14); color: var(--arc-info); }
.stage-tag.Distribute { background: rgba(124,158,245,0.14); color: #9db6f7; }
.stage-tag.Store { background: rgba(148,163,184,0.14); color: var(--arc-text-muted); }
.stage-tag.Use { background: rgba(34,197,94,0.12); color: var(--arc-healthy); }
.stage-tag.Rotate { background: var(--arc-pending-bg); color: var(--arc-governance); }
.stage-tag.Destroy { background: var(--arc-critical-bg); color: var(--arc-critical); }
</style>
