<template>
  <div class="dash">

    <!-- ── Command-center hero ─────────────────────────────── -->
    <section class="arc-hero dash-hero">
      <div class="hero-lead">
        <p class="hero-eyebrow">Cryptographic control plane</p>
        <h2 class="hero-title">Operational posture</h2>
        <p class="hero-sub">
          Supplier tenants, key custody, governance and cluster health —
          the Vault Enterprise estate at a glance. Isolation is enforced by Vault namespaces,
          not by this interface.
        </p>
      </div>
      <div class="hero-posture">
        <div class="posture-item" :class="clusterStatusClass">
          <span class="posture-dot" />
          <div>
            <div class="posture-value">{{ clusterHeadline }}</div>
            <div class="posture-label">Cluster</div>
          </div>
        </div>
        <div class="posture-item" :class="{ gold: stats.pendingApprovals > 0 }">
          <span class="posture-dot" />
          <div>
            <div class="posture-value">{{ stats.pendingApprovals }} pending</div>
            <div class="posture-label">Governance queue</div>
          </div>
        </div>
        <div class="posture-item">
          <span class="posture-dot" />
          <div>
            <div class="posture-value">{{ stats.suppliers }} tenants</div>
            <div class="posture-label">{{ stats.suppliers }} isolated namespaces</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── KPI strip ───────────────────────────────────────── -->
    <div class="kpi-row">
      <div class="arc-tile">
        <span class="arc-tile__label">Suppliers</span>
        <span class="arc-tile__value" :class="{ 'arc-refresh-pulse': pulse }">{{ fmt(stats.suppliers) }}</span>
        <span class="arc-tile__sub">tenant boundaries</span>
      </div>
      <div class="arc-tile">
        <span class="arc-tile__label">Applications</span>
        <span class="arc-tile__value" :class="{ 'arc-refresh-pulse': pulse }">{{ fmt(stats.applications) }}</span>
        <span class="arc-tile__sub">registered workloads</span>
      </div>
      <div class="arc-tile">
        <span class="arc-tile__label">Keys</span>
        <span class="arc-tile__value arc-tile__value--accent" :class="{ 'arc-refresh-pulse': pulse }">{{ fmt(stats.keys) }}</span>
        <span class="arc-tile__sub">transit + managed</span>
      </div>
      <div class="arc-tile arc-tile--gold">
        <span class="arc-tile__label">Pending approvals</span>
        <span class="arc-tile__value arc-tile__value--gold" :class="{ 'arc-refresh-pulse': pulse }">{{ fmt(stats.pendingApprovals) }}</span>
        <span class="arc-tile__sub">four-eyes governance</span>
      </div>
      <div class="arc-tile">
        <span class="arc-tile__label">Active namespaces</span>
        <span class="arc-tile__value" :class="{ 'arc-refresh-pulse': pulse }">{{ fmt(stats.namespaces) }}</span>
        <span class="arc-tile__sub">Vault Enterprise</span>
      </div>
      <div class="arc-tile" :class="clusterTileClass">
        <span class="arc-tile__label">Cluster health</span>
        <span class="arc-tile__value" :class="clusterValueClass">{{ clusterHeadline }}</span>
        <span class="arc-tile__sub">{{ clusterSub }}</span>
      </div>
    </div>

    <!-- ── Cryptographic lifecycle rail ────────────────────── -->
    <div class="dash-card">
      <div class="card-head">
        <h3 class="card-title">Cryptographic Lifecycle Coverage</h3>
        <span class="card-note">Generate → Distribute → Store → Use → Rotate → Destroy</span>
      </div>
      <div v-if="loading" class="row-loading">Assembling lifecycle evidence…</div>
      <div v-else class="arc-kml">
        <NuxtLink
          v-for="(s, i) in lifecycle"
          :key="s.stage"
          :to="`/evidence?stage=${s.stage}`"
          class="arc-kml__stage"
          :class="{ 'arc-kml__stage--on': s.demonstrated }"
        >
          <span class="arc-kml__idx">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="arc-kml__name">{{ s.stage }}</span>
          <span class="arc-kml__flag" :class="s.demonstrated ? 'arc-kml__flag--on' : 'arc-kml__flag--off'">
            {{ s.demonstrated ? 'Demonstrated' : 'Evidence pending' }}
          </span>
          <span class="arc-kml__meta">{{ s.detail }}</span>
        </NuxtLink>
      </div>
    </div>

    <!-- ── Supplier isolation + Governance ─────────────────── -->
    <div class="dash-grid">
      <div class="dash-card">
        <div class="card-head">
          <h3 class="card-title">Supplier Isolation</h3>
          <span class="iso-stamp" :class="isolation?.verified ? 'ok' : isolation === null ? 'checking' : 'untested'">
            {{ isolation?.verified ? '✓ verified' : isolation === null ? 'checking…' : 'not verified' }}
          </span>
          <NuxtLink to="/suppliers" class="card-link">Manage →</NuxtLink>
        </div>
        <div v-if="loading" class="row-loading">Loading tenants…</div>
        <div v-else-if="!suppliers.length" class="row-empty">No suppliers registered.</div>
        <div v-else class="tenant-domains">
          <NuxtLink
            v-for="s in suppliers.slice(0, 4)"
            :key="s.id"
            :to="`/suppliers/${s.id}`"
            class="tenant-domain"
          >
            <span class="tenant-mono">{{ initials(s.name) }}</span>
            <div class="tenant-body">
              <div class="tenant-name">{{ s.name }}</div>
              <code class="tenant-ns">{{ s.vault_namespace }}</code>
            </div>
            <span class="tenant-tier" :class="s.sla_tier">{{ s.sla_tier }}</span>
          </NuxtLink>
          <p class="tenant-note">
            <span class="iso-x">✕ cross-tenant access</span>
            Each supplier is a separate Vault Enterprise namespace.
            <template v-if="isolation?.verified">A live bidirectional check confirmed every cross-tenant read is denied.</template>
            <template v-else>Open a tenant for the access matrix, or run <code>scenarios/06_supplier_isolation/</code>.</template>
          </p>
        </div>
      </div>

      <div class="dash-card">
        <div class="card-head">
          <h3 class="card-title">Governance</h3>
          <NuxtLink to="/approvals" class="card-link">Workbench →</NuxtLink>
        </div>
        <div v-if="approvalsLoading" class="row-loading">Loading approvals…</div>
        <div v-else-if="approvalsError" class="row-error">{{ approvalsError }}</div>
        <div v-else>
          <div class="gov-stats">
            <div class="gov-stat">
              <span class="gov-num gold">{{ approvalStats.pending }}</span>
              <span class="gov-lab">Pending</span>
            </div>
            <div class="gov-stat">
              <span class="gov-num ok">{{ approvalStats.approved }}</span>
              <span class="gov-lab">Approved</span>
            </div>
            <div class="gov-stat">
              <span class="gov-num bad">{{ approvalStats.rejected }}</span>
              <span class="gov-lab">Denied</span>
            </div>
          </div>
          <div class="gov-mode">
            <span class="gov-mode-dot" />
            Enforcement: database record of decision. Vault Control Group authorization is a separate step.
          </div>
          <div class="gov-split">
            <span class="gov-split-lab">Source mix</span>
            <div class="gov-bar">
              <span
                v-for="seg in sourceSplit"
                :key="seg.key"
                class="gov-seg"
                :class="seg.key"
                :style="{ width: seg.pct + '%' }"
                :title="`${seg.key}: ${seg.count}`"
              />
            </div>
            <div class="gov-legend">
              <span v-for="seg in sourceSplit" :key="seg.key" class="gov-leg">
                <i :class="seg.key" />{{ seg.key }} {{ seg.count }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Cluster snapshot (collapsible, collapsed by default) ── -->
    <div class="dash-card">
      <div class="card-head">
        <button class="card-fold" :aria-expanded="showCluster" @click="toggleFold('cluster')">
          <span class="fold-caret" :class="{ open: showCluster }">▸</span>
          <h3 class="card-title">Cluster Snapshot <span class="card-title-sub">· {{ clusterHeadline }}</span></h3>
        </button>
        <NuxtLink to="/cluster" class="card-link">Topology →</NuxtLink>
      </div>
      <template v-if="showCluster">
        <div v-if="clusterLoading && !clusterNodes.length" class="row-loading">Polling node health…</div>
        <div v-else-if="clusterError" class="row-error">{{ clusterError }}</div>
        <ClusterTopology v-else :nodes="clusterNodes" />
      </template>
    </div>

    <!-- ── Reconciliation (collapsible, collapsed by default) — Prompt 20 ── -->
    <div class="dash-card">
      <div class="card-head">
        <button class="card-fold" :aria-expanded="showReconciliation" @click="toggleFold('reconciliation')">
          <span class="fold-caret" :class="{ open: showReconciliation }">▸</span>
          <h3 class="card-title">Reconciliation <span class="card-title-sub">· {{ reconciliationHeadline }}</span></h3>
        </button>
        <NuxtLink to="/reconciliation" class="card-link">Full detail →</NuxtLink>
      </div>
      <template v-if="showReconciliation">
        <div v-if="reconciliationLoading && !reconciliation.length" class="row-loading">Loading reconciliation state…</div>
        <div v-else-if="!reconciliation.length" class="row-empty">
          No desired state recorded yet. Provisioning an application with a rotation policy seeds it automatically.
        </div>
        <div v-else-if="!driftedRows.length" class="row-empty">
          All {{ reconciliation.length }} desired-state row{{ reconciliation.length === 1 ? '' : 's' }} compliant — Vault matches intent.
        </div>
        <div v-else class="table-wrap">
          <table class="arc-table">
            <thead>
              <tr><th>Application</th><th>Key</th><th>Desired</th><th>Observed</th><th>Disposition</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in driftedRows" :key="r.desired_state_id">
                <td>{{ r.application_name }}</td>
                <td class="mono">{{ r.key_name }}</td>
                <td>{{ r.desired_value?.days }}d</td>
                <td>{{ r.latest_run?.observed_value?.days ?? '—' }}{{ r.latest_run?.observed_value ? 'd' : '' }}</td>
                <td><span class="status-pill" :class="r.disposition">{{ r.disposition.replace('_', ' ') }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <!-- ── Recent evidence (collapsible, collapsed by default) ── -->
    <div class="dash-card">
      <div class="card-head">
        <button class="card-fold" :aria-expanded="showEvidence" @click="toggleFold('evidence')">
          <span class="fold-caret" :class="{ open: showEvidence }">▸</span>
          <h3 class="card-title">Recent evidence <span class="card-title-sub">· 5 most recent</span></h3>
        </button>
        <NuxtLink to="/evidence" class="card-link">Full trail →</NuxtLink>
      </div>
      <template v-if="showEvidence">
        <div v-if="approvalsLoading" class="row-loading">Loading evidence…</div>
        <div v-else-if="!evidenceRows.length" class="row-empty">
          No evidence recorded yet. Governance decisions and workload operations appear here.
        </div>
        <div v-else class="table-wrap">
          <table class="arc-table">
            <thead>
              <tr><th>Operation</th><th>Key</th><th>Actor</th><th>Source</th><th>Outcome</th><th>When</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in evidenceRows" :key="a.id">
                <td class="mono">{{ a.action }}</td>
                <td class="mono">{{ a.key_name }}</td>
                <td>{{ a.requester }}</td>
                <td><span class="source-pill" :class="a.source || 'external'">{{ a.source || 'external' }}</span></td>
                <td><span class="status-pill" :class="a.status">{{ a.status }}</span></td>
                <td class="muted">{{ relativeTime(a.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import { useClusterHealth } from '~/composables/useClusterHealth'
import type { ApprovalRecord, Supplier, Application, TransitKey, ReconciliationRow } from '~/types/arcanium'

definePageMeta({ layout: 'default' })
useHead({ title: 'Dashboard' })

const { applications: fetchApps, keys: fetchKeys, approvals: fetchApprovals, suppliers: fetchSuppliers, evidenceTrail, supplierIsolation, reconciliationList } = useArcaniumApi()
const { nodes: clusterNodes, loading: clusterLoading, error: clusterError, status: clusterStatus, healthyCount } = useClusterHealth()

const loading = ref(true)
const approvalsLoading = ref(true)
const approvalsError = ref('')

const keys = ref<TransitKey[]>([])
const apps = ref<Application[]>([])
const suppliers = ref<Supplier[]>([])
const allApprovals = ref<ApprovalRecord[]>([])
const cryptoOpsIngested = ref(0)
const stageCounts = ref<Record<string, number>>({})
const isolation = ref<{ verified: boolean } | null>(null)
const reconciliation = ref<ReconciliationRow[]>([])
const reconciliationLoading = ref(true)

// Collapsible dashboard panels — collapsed by default, the choice is remembered per browser.
const folds = ref<Record<string, boolean>>({ evidence: false, cluster: false, reconciliation: false })
onMounted(() => {
  for (const k of Object.keys(folds.value)) {
    try { folds.value[k] = localStorage.getItem(`arc.dash.${k}`) === 'open' } catch { /* private mode */ }
  }
})
function toggleFold(k: string) {
  folds.value[k] = !folds.value[k]
  try { localStorage.setItem(`arc.dash.${k}`, folds.value[k] ? 'open' : 'closed') } catch { /* ignore */ }
}
const showEvidence = computed(() => folds.value.evidence)
const showCluster = computed(() => folds.value.cluster)
const showReconciliation = computed(() => folds.value.reconciliation)

const driftedRows = computed(() => reconciliation.value.filter(r => r.observation_status === 'DRIFTED'))
const reconciliationHeadline = computed(() => {
  if (reconciliationLoading.value && !reconciliation.value.length) return 'checking…'
  if (!reconciliation.value.length) return 'no desired state yet'
  return `${driftedRows.value.length} drifted of ${reconciliation.value.length}`
})

const stats = computed(() => ({
  suppliers: suppliers.value.length,
  applications: apps.value.length,
  keys: keys.value.length,
  pendingApprovals: allApprovals.value.filter(a => a.status === 'pending').length,
  namespaces: new Set(suppliers.value.map(s => s.vault_namespace)).size,
}))

// ── Refresh pulse ──────────────────────────────────────────
const pulse = ref(false)
function firePulse() { pulse.value = false; requestAnimationFrame(() => { pulse.value = true }) }

// ── Cluster headline ───────────────────────────────────────
const clusterStatusClass = computed(() => {
  if (!clusterStatus.value || clusterStatus.value.unknown) return 'unknown'
  if (clusterStatus.value.healthy) return 'healthy'
  if (clusterStatus.value.degraded) return 'degraded'
  return 'critical'
})
const clusterHeadline = computed(() => {
  if (!clusterNodes.value.length) return clusterLoading.value ? 'Checking' : '—'
  if (clusterStatusClass.value === 'unknown') return 'Unavailable'
  return `${healthyCount.value}/${clusterNodes.value.length}`
})
const clusterSub = computed(() => {
  if (clusterStatusClass.value === 'healthy') return 'all nodes operational'
  if (clusterStatusClass.value === 'degraded') return 'service available, degraded'
  if (clusterStatusClass.value === 'critical') return 'sealed node detected'
  if (clusterStatusClass.value === 'unknown') return 'last observation stale'
  return 'nodes reporting'
})
const clusterTileClass = computed(() => clusterStatusClass.value === 'critical' ? 'arc-tile--gold' : '')
const clusterValueClass = computed(() => ({
  healthy: '', degraded: 'arc-tile__value--gold', critical: 'arc-tile__value--gold', unknown: '',
}[clusterStatusClass.value]))

// ── Approval stats ─────────────────────────────────────────
const approvalStats = computed(() => ({
  pending: allApprovals.value.filter(a => a.status === 'pending').length,
  approved: allApprovals.value.filter(a => a.status === 'approved').length,
  rejected: allApprovals.value.filter(a => a.status === 'rejected').length,
}))
const sourceSplit = computed(() => {
  const total = allApprovals.value.length || 1
  return (['manual', 'local', 'external'] as const).map(key => {
    const count = allApprovals.value.filter(a => (a.source || 'external') === key).length
    return { key, count, pct: Math.round((count / total) * 100) }
  }).filter(s => s.count > 0)
})
const evidenceRows = computed(() =>
  [...allApprovals.value]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 5)
)

// ── Lifecycle model — driven by the same KML stage tallies as /evidence ────
const lifecycle = computed(() => {
  const k = keys.value
  const sc = stageCounts.value
  const hasKeys = k.length > 0
  const rotateSignals = k.filter(x => (x.auto_rotate_period ?? 0) > 0).length
  return [
    {
      stage: 'Generate',
      demonstrated: hasKeys,
      detail: hasKeys ? `${k.length} keys generated via Vault Transit / PKI` : 'No keys generated yet',
    },
    {
      stage: 'Distribute',
      demonstrated: apps.value.length > 0,
      detail: apps.value.length
        ? `${apps.value.length} workloads provisioned via AppRole`
        : 'No workloads registered',
    },
    {
      stage: 'Store',
      demonstrated: hasKeys,
      detail: hasKeys ? 'Custody: Vault storage, SoftHSM auto-unseal seal' : 'No key material under custody',
    },
    {
      stage: 'Use',
      demonstrated: cryptoOpsIngested.value > 0,
      detail: cryptoOpsIngested.value > 0
        ? `${cryptoOpsIngested.value} workload crypto operations ingested from the Vault audit log`
        : 'Workload encrypt / sign operation ingestion not yet connected',
    },
    {
      stage: 'Rotate',
      demonstrated: (sc.Rotate ?? 0) > 0 || rotateSignals > 0,
      detail: (sc.Rotate ?? 0) > 0
        ? `${sc.Rotate} rotation events in the evidence trail`
        : rotateSignals > 0 ? `${rotateSignals} keys with an auto-rotation policy` : 'No rotation policy or events recorded',
    },
    {
      stage: 'Destroy',
      demonstrated: (sc.Destroy ?? 0) > 0,
      detail: (sc.Destroy ?? 0) > 0
        ? `${sc.Destroy} revoke / destroy events recorded`
        : 'No destroy events recorded — key deletion protected',
    },
  ]
})

// ── Helpers ────────────────────────────────────────────────
function fmt(n: number) { return Number.isFinite(n) ? n.toLocaleString('en-GB') : '—' }
function initials(name: string) { return name.slice(0, 2).toUpperCase() }
function relativeTime(ts: string) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

async function loadApprovals() {
  try {
    const data = await fetchApprovals({ all: true })
    allApprovals.value = Array.isArray(data) ? data : []
    approvalsError.value = ''
    firePulse()
  } catch {
    approvalsError.value = 'Unable to load approvals'
  } finally {
    approvalsLoading.value = false
  }
}

onMounted(async () => {
  const [a, k, s, e] = await Promise.allSettled([
    fetchApps(), fetchKeys(), fetchSuppliers(), evidenceTrail(),
  ])
  if (a.status === 'fulfilled' && Array.isArray(a.value)) apps.value = a.value
  if (k.status === 'fulfilled' && Array.isArray(k.value)) keys.value = k.value
  if (s.status === 'fulfilled' && Array.isArray(s.value)) suppliers.value = s.value
  if (e.status === 'fulfilled' && e.value) {
    stageCounts.value = e.value.stage_counts ?? {}
    cryptoOpsIngested.value = e.value.stage_counts?.Use ?? e.value.total ?? 0
  }
  loading.value = false
  await loadApprovals()
  supplierIsolation().then(r => { isolation.value = r }).catch(() => { isolation.value = null })
  reconciliationList().then(r => { reconciliation.value = Array.isArray(r) ? r : [] }).catch(() => {}).finally(() => { reconciliationLoading.value = false })
})
usePolling(loadApprovals, 10000)
watch(healthyCount, firePulse)
</script>

<style scoped>
.dash { display: flex; flex-direction: column; gap: 18px; }

/* Hero */
.dash-hero { display: flex; gap: 32px; align-items: center; flex-wrap: wrap; }
.hero-lead { flex: 1; min-width: 260px; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 24px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 460px; margin: 0; }
.hero-posture { display: flex; gap: 10px; flex-wrap: wrap; }
.posture-item {
  display: flex; align-items: center; gap: 10px;
  background: rgba(0, 8, 24, 0.35); border: 1px solid var(--arc-glass-border);
  border-radius: 10px; padding: 10px 14px; min-width: 150px;
}
.posture-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--arc-text-dim); flex-shrink: 0; }
.posture-item.healthy .posture-dot { background: var(--arc-healthy); box-shadow: 0 0 8px rgba(34,197,94,0.5); }
.posture-item.degraded .posture-dot { background: var(--arc-warning); }
.posture-item.critical .posture-dot { background: var(--arc-critical); }
.posture-item.gold .posture-dot { background: var(--arc-pending); box-shadow: 0 0 8px var(--arc-glow-gold); }
.posture-value { font-size: 14px; font-weight: 700; color: var(--arc-text-primary); }
.posture-label { font-size: 10.5px; color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.06em; }

/* KPI row */
.kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
@media (max-width: 1100px) { .kpi-row { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 560px) { .kpi-row { grid-template-columns: repeat(2, 1fr); } }

/* Cards */
.dash-card {
  background: var(--arc-glass);
  border: 1px solid var(--arc-glass-border);
  border-radius: var(--arc-radius);
  padding: 18px 20px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: inset 0 1px 0 var(--arc-glass-hi);
}
.dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 940px) { .dash-grid { grid-template-columns: 1fr; } }

.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 12px; }
.card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em; color: var(--arc-text-primary); margin: 0; }
.card-title-sub { font-weight: 500; letter-spacing: 0.04em; color: var(--arc-text-muted); }
.card-fold { display: flex; align-items: center; gap: 8px; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; font: inherit; color: inherit; }
.card-fold:hover .card-title,
.card-fold:hover .fold-caret { color: var(--arc-action-bright); }
.fold-caret { font-size: 11px; color: var(--arc-text-muted); transition: transform 0.15s, color 0.15s; display: inline-block; }
.fold-caret.open { transform: rotate(90deg); }
.card-note { font-size: 10.5px; color: var(--arc-text-dim); font-family: ui-monospace, monospace; }
.card-link { font-size: 12px; color: var(--arc-action-bright); text-decoration: none; white-space: nowrap; }
.card-link:hover { text-decoration: underline; }

.row-loading, .row-empty, .row-error { font-size: 12.5px; padding: 12px 0; color: var(--arc-text-muted); }
.row-error { color: var(--arc-critical); }
.row-empty { color: var(--arc-text-muted); }

/* Tenant domains */
.tenant-domains { display: flex; flex-direction: column; gap: 8px; }
.tenant-domain {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(4, 16, 38, 0.5); border: 1px solid var(--arc-border-subtle);
  text-decoration: none; transition: border-color 0.15s, transform 0.15s;
}
.tenant-domain:hover { border-color: rgba(0, 180, 216, 0.35); transform: translateX(2px); }
.tenant-mono {
  width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
  display: grid; place-items: center; font-size: 13px; font-weight: 700;
  color: var(--arc-info); border: 1px solid var(--arc-border-strong);
  background: linear-gradient(140deg, var(--arc-bg-surface), var(--arc-bg-card));
}
.tenant-body { flex: 1; min-width: 0; }
.tenant-name { font-size: 13px; font-weight: 700; color: var(--arc-text-primary); }
.tenant-ns { font-size: 11px; color: var(--arc-text-muted); font-family: ui-monospace, monospace; }
.tenant-tier {
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  padding: 2px 7px; border-radius: 5px;
}
.tenant-tier.premium { background: var(--arc-pending-bg); color: var(--arc-governance); }
.tenant-tier.standard { background: rgba(0, 119, 182, 0.12); color: var(--arc-action-bright); }
.tenant-note { font-size: 11px; color: var(--arc-text-muted); line-height: 1.55; margin: 8px 0 0; }
.tenant-note code { font-family: ui-monospace, monospace; color: var(--arc-text-secondary); }
.iso-x { display: inline-block; font-weight: 700; color: var(--arc-critical); margin-right: 6px; }
.card-head .iso-stamp { margin-right: auto; }
.iso-stamp { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 7px; border-radius: 100px; }
.iso-stamp.ok { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.iso-stamp.untested { background: var(--arc-pending-bg); color: var(--arc-governance); }
.iso-stamp.checking { background: rgba(125,133,151,0.14); color: var(--arc-text-muted); }

/* Governance */
.gov-stats { display: flex; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid var(--arc-border-subtle); }
.gov-stat { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.gov-num { font-size: 22px; font-weight: 750; font-variant-numeric: tabular-nums; }
.gov-num.gold { color: var(--arc-pending); }
.gov-num.ok { color: var(--arc-healthy); }
.gov-num.bad { color: var(--arc-critical); }
.gov-lab { font-size: 10px; color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.07em; }
.gov-mode { display: flex; gap: 8px; align-items: flex-start; font-size: 11px; color: var(--arc-text-muted); line-height: 1.5; padding: 12px 0; }
.gov-mode-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--arc-governance); margin-top: 5px; flex-shrink: 0; }
.gov-split-lab { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--arc-text-muted); }
.gov-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--arc-bg-neutral); margin: 6px 0; }
.gov-seg.manual { background: #7c9ef5; }
.gov-seg.local { background: var(--arc-info); }
.gov-seg.external { background: var(--arc-governance); }
.gov-legend { display: flex; gap: 12px; flex-wrap: wrap; }
.gov-leg { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--arc-text-muted); text-transform: capitalize; }
.gov-leg i { width: 8px; height: 8px; border-radius: 2px; }
.gov-leg i.manual { background: #7c9ef5; }
.gov-leg i.local { background: var(--arc-info); }
.gov-leg i.external { background: var(--arc-governance); }

/* Node strip */
.node-strip { display: flex; gap: 10px; flex-wrap: wrap; }
.node-chip {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; border-radius: 10px; font-size: 12px;
  background: rgba(4, 16, 38, 0.5); border: 1px solid var(--arc-border-subtle);
}
.node-chip-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--arc-text-dim); flex-shrink: 0; }
.node-chip.healthy .node-chip-dot { background: var(--arc-healthy); box-shadow: 0 0 7px rgba(34,197,94,0.5); }
.node-chip.sealed .node-chip-dot { background: var(--arc-critical); }
.node-chip.unreachable .node-chip-dot, .node-chip.uninitialized .node-chip-dot { background: var(--arc-text-dim); }
.node-chip-name { font-weight: 700; color: var(--arc-text-primary); }
.node-chip-role { color: var(--arc-text-muted); font-size: 10.5px; }
.node-chip-ver { color: var(--arc-text-dim); font-size: 10.5px; }

/* Table */
.table-wrap { border: 1px solid var(--arc-border-subtle); border-radius: 10px; overflow: hidden; }
.arc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.arc-table th {
  text-align: left; padding: 9px 14px; font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.07em; color: var(--arc-text-muted);
  background: rgba(0, 8, 24, 0.4); border-bottom: 1px solid var(--arc-border-subtle);
}
.arc-table td { padding: 10px 14px; border-bottom: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.arc-table tr:last-child td { border-bottom: none; }
.arc-table tbody tr:hover td { background: rgba(255,255,255,0.02); }
.mono { font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--arc-action-bright); }
.muted { color: var(--arc-text-muted) !important; font-size: 11px; }

.status-pill { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 100px; text-transform: capitalize; }
.status-pill.pending { background: var(--arc-pending-bg); color: var(--arc-governance); }
.status-pill.approved { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.status-pill.rejected { background: var(--arc-critical-bg); color: var(--arc-critical); }
.status-pill.OPEN { background: rgba(148,163,184,0.14); color: var(--arc-text-muted); }
.status-pill.EXCEPTION_ACCEPTED { background: var(--arc-pending-bg); color: var(--arc-governance); }
.status-pill.RECONCILED { background: rgba(72,202,228,0.12); color: var(--arc-info); }
.source-pill { font-size: 9.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.06em; }
.source-pill.manual { background: rgba(124,158,245,0.14); color: #9db6f7; }
.source-pill.local { background: rgba(72,202,228,0.12); color: var(--arc-info); }
.source-pill.external { background: var(--arc-pending-bg); color: var(--arc-governance); }
</style>
