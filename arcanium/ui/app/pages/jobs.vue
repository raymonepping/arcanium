<template>
  <div class="jobs">
    <section class="arc-hero jobs-hero">
      <div>
        <p class="hero-eyebrow">Runtime orchestration</p>
        <h2 class="hero-title">Provisioning jobs</h2>
        <p class="hero-sub">
          Every change Arcanium makes to Vault — a supplier namespace, a workload
          identity, a key rotation — runs as a job with ordered, reversible steps.
          Failed jobs roll back the steps that succeeded.
        </p>
      </div>
      <div class="jobs-filter">
        <button v-for="f in filters" :key="f" class="chip" :class="{ on: filter === f }" @click="filter = f">
          {{ f }}
        </button>
      </div>
    </section>

    <div v-if="loading" class="state"><div class="spinner" /><span>Loading jobs…</span></div>
    <div v-else-if="error" class="state err">{{ error }}</div>
    <div v-else-if="!filtered.length" class="state">No {{ filter === 'all' ? '' : filter + ' ' }}jobs yet. Provision a supplier or an application to see one here.</div>

    <div v-else class="job-list">
      <div v-for="j in paginated" :key="j.id" class="job" :class="j.status">
        <button class="job-head" @click="toggle(j.id)">
          <span class="job-dot" :class="j.status" />
          <span class="job-action">{{ j.action }}</span>
          <span class="job-target">{{ j.target_type }} · {{ j.target_name || j.target_id.slice(0, 8) }}</span>
          <span class="job-status" :class="j.status">{{ j.status.replace('_', ' ') }}</span>
          <span class="job-when">{{ rel(j.created_at) }}</span>
          <span class="job-caret">{{ open.has(j.id) ? '▾' : '▸' }}</span>
        </button>
        <div v-if="open.has(j.id)" class="job-steps">
          <div v-for="(s, i) in j.steps" :key="i" class="step" :class="s.status">
            <span class="step-dot" :class="s.status" />
            <span class="step-name">{{ s.step }}</span>
            <span v-if="s.detail && typeof s.detail === 'string'" class="step-detail">{{ s.detail }}</span>
          </div>
          <div v-if="j.error" class="job-error">{{ j.error }}</div>
        </div>
      </div>
      <RecordPagination v-model:page="page" :total="filtered.length" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { ProvisioningJob } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })
useHead({ title: 'Provisioning Jobs' })

const PER = 10
const { jobs: fetchJobs } = useArcaniumApi()
const loading = ref(true)
const error = ref('')
const list = ref<ProvisioningJob[]>([])
const open = ref(new Set<string>())
const filters = ['all', 'succeeded', 'failed', 'rolled_back', 'running'] as const
const filter = ref<typeof filters[number]>('all')
const page = ref(1)

const filtered = computed(() =>
  filter.value === 'all' ? list.value : list.value.filter(j => j.status === filter.value),
)
const paginated = computed(() => filtered.value.slice((page.value - 1) * PER, page.value * PER))
watch(filter, () => { page.value = 1 })

function toggle(id: string) {
  const s = new Set(open.value)
  s.has(id) ? s.delete(id) : s.add(id)
  open.value = s
}
function rel(ts: string) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

async function load() {
  try {
    list.value = await fetchJobs()
  } catch (e: unknown) {
    error.value = apiErrorMessage(e, 'Failed to load jobs.')
  } finally {
    loading.value = false
  }
}
onMounted(load)
usePolling(load, 10000)
</script>

<style scoped>
.jobs { display: flex; flex-direction: column; gap: 18px; }
.jobs-hero { display: flex; gap: 28px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 500px; margin: 0; }
.jobs-filter { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font-family: inherit; font-size: 11px; text-transform: capitalize; padding: 5px 11px; border-radius: 100px; border: 1px solid var(--arc-glass-border); background: rgba(0,8,24,0.4); color: var(--arc-text-muted); cursor: pointer; }
.chip.on { border-color: var(--arc-action-bright); color: var(--arc-text-primary); }

.state { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 60px 20px; color: var(--arc-text-muted); font-size: 13px; text-align: center; }
.state.err { color: var(--arc-critical); }
.spinner { width: 22px; height: 22px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.job-list { display: flex; flex-direction: column; gap: 8px; }
.job { border: 1px solid var(--arc-glass-border); border-radius: 12px; background: var(--arc-glass); overflow: hidden; }
.job.failed, .job.rolled_back { border-color: rgba(220,47,2,0.3); }
.job-head { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: none; border: none; cursor: pointer; font-family: inherit; text-align: left; }
.job-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--arc-text-dim); }
.job-dot.succeeded { background: var(--arc-healthy); }
.job-dot.failed, .job-dot.rolled_back { background: var(--arc-critical); }
.job-dot.running { background: var(--arc-action-bright); }
.job-action { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--arc-text-primary); }
.job-target { font-size: 12px; color: var(--arc-text-secondary); flex: 1; }
.job-status { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 5px; }
.job-status.succeeded { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.job-status.failed, .job-status.rolled_back { background: var(--arc-critical-bg); color: var(--arc-critical); }
.job-status.running { background: rgba(0,180,216,0.12); color: var(--arc-action-bright); }
.job-status.pending { background: rgba(125,133,151,0.12); color: var(--arc-text-muted); }
.job-when { font-size: 11px; color: var(--arc-text-dim); }
.job-caret { font-size: 10px; color: var(--arc-text-dim); }

.job-steps { padding: 4px 16px 14px 36px; display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--arc-border-subtle); }
.step { display: flex; align-items: baseline; gap: 10px; font-size: 12px; padding: 4px 0; }
.step-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--arc-text-dim); flex-shrink: 0; align-self: center; }
.step-dot.succeeded { background: var(--arc-healthy); }
.step-dot.failed { background: var(--arc-critical); }
.step-dot.running { background: var(--arc-action-bright); }
.step-name { color: var(--arc-text-secondary); }
.step.failed .step-name { color: var(--arc-critical); }
.step-detail { color: var(--arc-text-dim); font-family: ui-monospace, monospace; font-size: 10.5px; }
.job-error { font-size: 11px; color: var(--arc-critical); font-family: ui-monospace, monospace; margin-top: 6px; padding: 8px 10px; background: var(--arc-critical-bg); border-radius: 6px; }
</style>
