<template>
  <div>
    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Loading application…</span></div>
    <div v-else-if="error" class="state-error"><div class="error-icon">⚠</div><p>{{ error }}</p></div>
    <div v-else-if="app">
      <!-- Breadcrumb -->
      <div class="breadcrumb">
        <NuxtLink to="/applications" class="bc-link">Applications</NuxtLink>
        <span class="bc-sep">›</span>
        <span class="bc-current">{{ app.name }}</span>
      </div>

      <!-- Header -->
      <div class="app-hero">
        <div class="hero-avatar">{{ app.name.slice(0, 2).toUpperCase() }}</div>
        <div class="hero-meta">
          <h2 class="hero-name">{{ app.name }}</h2>
          <div class="hero-id mono">{{ app.id }}</div>
          <div v-if="app.description" class="hero-desc">{{ app.description }}</div>
        </div>
        <div class="hero-side">
          <div v-if="app.supplier_id" class="hero-supplier">
            <span class="meta-label">Supplier</span>
            <NuxtLink :to="`/suppliers/${app.supplier_id}`" class="supplier-link">
              {{ supplierName ?? app.supplier_id }}
            </NuxtLink>
          </div>
          <div class="hero-registered">
            <span class="meta-label">Registered</span>
            <span class="meta-value">{{ formatDate(app.registered_at) }}</span>
          </div>
          <!-- Classification -->
          <div class="hero-category">
            <span class="meta-label">Category</span>
            <span :class="['cat-badge', `cat-${app.category ?? 'unscoped'}`]">{{ app.category ?? 'unscoped' }}</span>
            <button class="classify-toggle" @click="showClassify = !showClassify">
              {{ showClassify ? 'cancel' : 'classify' }}
            </button>
          </div>
          <div v-if="showClassify" class="classify-form">
            <select v-model="classifyVal" class="classify-select">
              <option value="platform">platform</option>
              <option value="tenant">tenant</option>
              <option value="unscoped">unscoped</option>
            </select>
            <button class="classify-save" :disabled="classifying" @click="doClassify">
              {{ classifying ? '…' : 'Save' }}
            </button>
          </div>
          <p v-if="classifyMsg" class="classify-msg">{{ classifyMsg }}</p>
          <button class="primary-button" :disabled="provisioning" @click="doProvision">
            {{ provisioning ? 'Provisioning…' : 'Provision crypto' }}
          </button>
        </div>
      </div>
      <p v-if="provisionMsg" class="provision-msg">{{ provisionMsg }}</p>

      <!-- Crypto profiles -->
      <div class="section-header">
        <h3 class="section-title">Crypto Profiles</h3>
        <span class="count-badge">{{ app.crypto_profiles?.length ?? 0 }}</span>
      </div>
      <div v-if="!app.crypto_profiles?.length" class="empty-panel">
        No crypto profiles registered for this application.
      </div>
      <div v-else class="profile-grid">
        <div
          v-for="p in app.crypto_profiles"
          :key="p.id"
          class="profile-card"
          :class="p.type"
        >
          <div class="profile-type-badge" :class="p.type">{{ p.type }}</div>
          <div class="profile-path mono">{{ p.vault_path }}</div>
          <div class="profile-id mono">{{ p.id }}</div>
          <div class="profile-ts muted">Configured {{ formatDate(p.created_at) }}</div>
        </div>
      </div>

      <!-- Related approvals -->
      <div class="section-header" style="margin-top: 24px;">
        <h3 class="section-title">Approval History</h3>
        <NuxtLink to="/approvals" class="section-link">View all →</NuxtLink>
      </div>
      <div v-if="approvalLoading" class="card-loading">Loading…</div>
      <div v-else-if="!appApprovals.length" class="empty-panel">No approval records for this application.</div>
      <table v-else class="arc-table">
        <thead>
          <tr><th>Action</th><th>Key</th><th>Status</th><th>Requester</th><th>Time</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in appApprovals" :key="a.id">
            <td class="mono">{{ a.action }}</td>
            <td class="mono">{{ a.key_name }}</td>
            <td><span class="status-pill" :class="a.status">{{ a.status }}</span></td>
            <td>{{ a.requester }}</td>
            <td class="muted">{{ relativeTime(a.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { Application, ApprovalRecord, Supplier } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })

const route = useRoute()
const id = route.params.id as string
const { application, approvals: fetchApprovals, suppliers: fetchSuppliers, provisionApplication } = useArcaniumApi()

const provisioning = ref(false)
const provisionMsg = ref('')

const showClassify = ref(false)
const classifyVal = ref<'platform' | 'tenant' | 'unscoped'>('unscoped')
const classifying = ref(false)
const classifyMsg = ref('')

async function doClassify() {
  if (classifying.value || !app.value) return
  classifying.value = true; classifyMsg.value = ''
  try {
    const updated = await $fetch(`/gateway/api/v1/applications/${id}/classify`, {
      method: 'POST',
      body: { category: classifyVal.value },
    })
    app.value = { ...app.value, ...(updated as Partial<Application>) }
    showClassify.value = false
    classifyMsg.value = `Classified as ${classifyVal.value}`
  } catch (e: unknown) {
    classifyMsg.value = apiErrorMessage(e, 'Classification failed.')
  } finally { classifying.value = false }
}

async function doProvision() {
  if (provisioning.value) return
  provisioning.value = true; provisionMsg.value = ''
  try {
    const r = await provisionApplication(id, { custody: 'vault', capabilities: ['encrypt', 'decrypt'], rotation_days: 30 })
    const j = r.provisioning_job
    provisionMsg.value = j.status === 'succeeded'
      ? `Provisioned — ${j.steps.length} steps. AppRole + policy + Transit key created. See Jobs.`
      : `Provisioning ${j.status}: ${j.error ?? 'see Jobs'}`
  } catch (e: unknown) {
    provisionMsg.value = apiErrorMessage(e, 'Provisioning failed.')
  } finally { provisioning.value = false }
}

const loading = ref(true)
const error = ref('')
const app = ref<Application | null>(null)
const supplierName = ref<string | null>(null)
const approvalLoading = ref(true)
const appApprovals = ref<ApprovalRecord[]>([])

useHead({ title: computed(() => app.value?.name ?? 'Application') })

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function relativeTime(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

onMounted(async () => {
  try {
    app.value = await application(id)
  } catch (e: unknown) {
    error.value = apiErrorMessage(e, 'Application not found.')
    loading.value = false
    return
  }
  loading.value = false

  // Load supplier name + approvals
  const [suppliersResult, approvalsResult] = await Promise.allSettled([
    fetchSuppliers(),
    fetchApprovals({ all: true }),
  ])
  if (suppliersResult.status === 'fulfilled' && app.value?.supplier_id) {
    const match = (suppliersResult.value as Supplier[]).find(s => s.id === app.value!.supplier_id)
    supplierName.value = match?.name ?? null
  }
  if (approvalsResult.status === 'fulfilled') {
    appApprovals.value = (approvalsResult.value as ApprovalRecord[]).filter(a => a.app_id === id)
  }
  approvalLoading.value = false
})
</script>

<style scoped>
.state-loading, .state-error {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; gap: 12px; color: var(--arc-text-muted);
}
.spinner { width: 32px; height: 32px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-icon { font-size: 28px; color: var(--arc-critical); }
.breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 20px; }
.bc-link { color: var(--arc-action-bright); text-decoration: none; }
.bc-link:hover { text-decoration: underline; }
.bc-sep { color: var(--arc-text-dim); }
.bc-current { color: var(--arc-text-secondary); }

.app-hero {
  display: flex; align-items: flex-start; gap: 16px;
  background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle);
  border-radius: 12px; padding: 20px; margin-bottom: 24px;
}
.hero-avatar {
  width: 48px; height: 48px; border-radius: 10px; background: var(--arc-bg-elevated);
  border: 1px solid var(--arc-border-strong); display: flex; align-items: center;
  justify-content: center; font-weight: 700; font-size: 14px; color: var(--arc-action-bright); flex-shrink: 0;
}
.hero-meta { flex: 1; }
.hero-name { font-size: 18px; font-weight: 700; color: var(--arc-text-primary); margin: 0 0 4px; }
.hero-id { font-size: 11px; color: var(--arc-text-muted); margin-bottom: 4px; }
.hero-desc { font-size: 13px; color: var(--arc-text-secondary); }
.hero-side { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.meta-label { font-size: 10px; color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-right: 6px; }
.meta-value { font-size: 12px; color: var(--arc-text-secondary); }
.supplier-link { font-size: 12px; color: var(--arc-action-bright); text-decoration: none; }
.supplier-link:hover { text-decoration: underline; }
.provision-msg { font-size: 12px; color: var(--arc-action-bright); margin: 0 0 20px; line-height: 1.5; padding: 10px 14px; background: rgba(0,119,182,0.08); border: 1px solid var(--arc-glass-border); border-radius: 8px; }

.section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-primary); margin: 0; }
.count-badge { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 100px; background: rgba(0,119,182,0.1); color: var(--arc-action-bright); }
.section-link { margin-left: auto; font-size: 12px; color: var(--arc-action-bright); text-decoration: none; }
.section-link:hover { text-decoration: underline; }
.empty-panel { background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 10px; padding: 24px; text-align: center; font-size: 13px; color: var(--arc-text-muted); }
.card-loading { font-size: 13px; color: var(--arc-text-muted); padding: 10px 0; }

.profile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.profile-card {
  background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle);
  border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 6px;
}
.profile-type-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  padding: 2px 8px; border-radius: 4px; align-self: flex-start;
}
.profile-type-badge.transit { background: rgba(0,119,182,0.1); color: var(--arc-action-bright); }
.profile-type-badge.pki { background: rgba(34,197,94,0.1); color: var(--arc-healthy); }
.profile-type-badge.kmip { background: rgba(255,170,0,0.1); color: var(--arc-governance); }
.profile-type-badge.managed_key { background: rgba(125,133,151,0.1); color: var(--arc-text-secondary); }
.profile-path { font-size: 12px; color: var(--arc-action-bright); word-break: break-all; }
.profile-id { font-size: 10px; color: var(--arc-text-muted); }
.profile-ts { font-size: 11px; }

.mono { font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace; font-size: 11px; color: var(--arc-action-bright); }
.muted { color: var(--arc-text-muted) !important; font-size: 12px; }

.arc-table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 10px; overflow: hidden; }
.arc-table th { text-align: left; padding: 10px 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); border-bottom: 1px solid var(--arc-border-subtle); background: var(--arc-bg-shell); }
.arc-table td { padding: 10px 16px; border-bottom: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.arc-table tr:last-child td { border-bottom: none; }
.status-pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 100px; text-transform: capitalize; }
.status-pill.pending { background: var(--arc-pending-bg); color: var(--arc-governance); }
.status-pill.approved { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.status-pill.rejected { background: var(--arc-critical-bg); color: var(--arc-critical); }
.hero-category { display: flex; align-items: center; gap: 6px; }
.cat-badge {
  display: inline-block; font-size: 10px; font-weight: 600;
  padding: 1px 7px; border-radius: 10px; letter-spacing: 0.03em; text-transform: lowercase;
}
.cat-platform { background: rgba(124,134,152,0.15); color: var(--arc-text-muted); }
.cat-tenant   { background: rgba(0,119,182,0.15);  color: var(--arc-action-bright); }
.cat-unscoped { background: rgba(255,170,0,0.15);  color: var(--arc-governance); }
.classify-toggle {
  font-size: 10px; color: var(--arc-text-muted); background: none; border: none;
  cursor: pointer; padding: 0 4px; text-decoration: underline;
}
.classify-toggle:hover { color: var(--arc-action-bright); }
.classify-form { display: flex; align-items: center; gap: 6px; }
.classify-select {
  font-size: 12px; background: var(--arc-bg-elevated); color: var(--arc-text-primary);
  border: 1px solid var(--arc-border-strong); border-radius: 6px; padding: 3px 8px;
}
.classify-save {
  font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 6px;
  background: var(--arc-action-primary); color: #fff; border: none; cursor: pointer;
}
.classify-save:hover:not(:disabled) { background: var(--arc-action-hover); }
.classify-save:disabled { opacity: 0.5; cursor: default; }
.classify-msg { font-size: 11px; color: var(--arc-action-bright); margin: 2px 0 0; }
</style>
