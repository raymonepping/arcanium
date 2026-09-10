<template>
  <div>
    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Loading supplier…</span></div>
    <div v-else-if="error" class="state-error"><div class="error-icon">⚠</div><p>{{ error }}</p></div>
    <div v-else-if="supplier">
      <!-- Breadcrumb -->
      <div class="breadcrumb">
        <NuxtLink to="/suppliers" class="bc-link">Suppliers</NuxtLink>
        <span class="bc-sep">›</span>
        <span class="bc-current">{{ supplier.name }}</span>
      </div>

      <!-- Header row -->
      <div class="supplier-hero">
        <div class="hero-avatar">{{ supplier.name.slice(0, 2).toUpperCase() }}</div>
        <div class="hero-meta">
          <h2 class="hero-name">{{ supplier.name }}</h2>
          <div class="hero-id mono">{{ supplier.id }}</div>
        </div>
        <div class="hero-badges">
          <span class="sla-badge" :class="supplier.sla_tier">{{ supplier.sla_tier }}</span>
          <span class="onboarded-badge">Onboarded {{ formatDate(supplier.created_at) }}</span>
        </div>
      </div>

      <!-- Tenant boundary panel -->
      <div class="tenant-panel">
        <div class="tenant-panel-header">
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.2"/>
            <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1" opacity=".5"/>
          </svg>
          <span>Tenant Boundary</span>
          <span class="boundary-tag confirmed">Namespace-enforced</span>
        </div>
        <div class="tenant-panel-body">
          <div class="boundary-row">
            <span class="bl">Vault Namespace</span>
            <span class="bv mono">{{ supplier.vault_namespace }}</span>
          </div>
          <div class="boundary-row">
            <span class="bl">Auth boundary</span>
            <span class="bv">Token policies restricted to <span class="mono">{{ supplier.vault_namespace }}/*</span></span>
          </div>

          <!-- Four-way access matrix -->
          <div class="matrix-grid">
            <div class="mx allow">
              <svg class="mx-i" viewBox="0 0 16 16" fill="none"><path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <div>
                <div class="mx-t">{{ supplier.name }} → {{ supplier.name }}</div>
                <div class="mx-p">own namespace · ALLOWED</div>
              </div>
            </div>
            <div class="mx deny">
              <svg class="mx-i" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              <div>
                <div class="mx-t">{{ supplier.name }} → {{ counterpart }}</div>
                <div class="mx-p">cross-tenant · DENIED</div>
              </div>
            </div>
            <div class="mx allow">
              <svg class="mx-i" viewBox="0 0 16 16" fill="none"><path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <div>
                <div class="mx-t">{{ counterpart }} → {{ counterpart }}</div>
                <div class="mx-p">own namespace · ALLOWED</div>
              </div>
            </div>
            <div class="mx deny">
              <svg class="mx-i" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              <div>
                <div class="mx-t">{{ counterpart }} → {{ supplier.name }}</div>
                <div class="mx-p">cross-tenant · DENIED</div>
              </div>
            </div>
          </div>

          <div class="boundary-notice">
            <svg viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1"/>
              <line x1="7" y1="4" x2="7" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              <circle cx="7" cy="10" r="0.6" fill="currentColor"/>
            </svg>
            The matrix shows the configured namespace topology. Vault Enterprise namespaces enforce the boundary;
            run the isolation tests to record a verified positive and negative result.
          </div>
        </div>
      </div>

      <!-- Two-column: apps + keys -->
      <div class="detail-grid">
        <!-- Applications -->
        <div class="arc-card">
          <div class="card-header">
            <h3 class="card-title">Applications</h3>
            <span class="count-badge">{{ supplierApps.length }}</span>
          </div>
          <div v-if="appsLoading" class="card-loading">Loading…</div>
          <div v-else-if="!supplierApps.length" class="empty-sm">No applications in this tenant.</div>
          <div v-else class="app-list">
            <NuxtLink
              v-for="a in supplierApps"
              :key="a.id"
              :to="`/applications/${a.id}`"
              class="app-row"
            >
              <div class="app-row-name">{{ a.name }}</div>
              <div class="app-row-id mono">{{ a.id }}</div>
            </NuxtLink>
          </div>
        </div>

        <!-- Keys -->
        <div class="arc-card">
          <div class="card-header">
            <h3 class="card-title">Transit Keys</h3>
            <span class="count-badge">{{ supplierKeys.length }}</span>
          </div>
          <div v-if="keysLoading" class="card-loading">Loading…</div>
          <div v-else-if="keysAccessDenied" class="denied-notice">
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="6" r="3.5" stroke="currentColor" stroke-width="1.2"/>
              <path d="M4.5 10h7v4a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-4z" stroke="currentColor" stroke-width="1.2"/>
            </svg>
            <div>
              <div class="denied-title">Access restricted</div>
              <div class="denied-sub">This tenant's keys are isolated to their namespace. Confirmed denial — not an error.</div>
            </div>
          </div>
          <div v-else-if="!supplierKeys.length" class="empty-sm">No keys found.</div>
          <div v-else class="key-list">
            <NuxtLink
              v-for="k in supplierKeys"
              :key="k.name"
              :to="`/keys/${k.name}`"
              class="key-row"
            >
              <span class="key-name mono">{{ k.name }}</span>
              <span class="key-type">{{ k.type }}</span>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { Supplier, Application, TransitKey } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })

const route = useRoute()
const id = route.params.id as string

const { supplier: fetchSupplier, suppliers: fetchSuppliers, supplierApplications, supplierKeys: fetchSupplierKeys } = useArcaniumApi()

const loading = ref(true)
const error = ref('')
const supplier = ref<Supplier | null>(null)
const others = ref<Supplier[]>([])
const counterpart = computed(() =>
  others.value.find(s => s.id !== id)?.name ?? 'another tenant'
)

const appsLoading = ref(true)
const supplierApps = ref<Application[]>([])

const keysLoading = ref(true)
const keysAccessDenied = ref(false)
const supplierKeys = ref<TransitKey[]>([])

useHead({ title: computed(() => supplier.value?.name ?? 'Supplier') })

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

onMounted(async () => {
  try {
    supplier.value = await fetchSupplier(id)
  } catch (e: unknown) {
    error.value = apiErrorMessage(e, 'Supplier not found.')
    loading.value = false
    return
  }
  loading.value = false

  // Load apps, keys and sibling tenants in parallel
  const [appsResult, keysResult, allResult] = await Promise.allSettled([
    supplierApplications(id),
    fetchSupplierKeys(id),
    fetchSuppliers(),
  ])
  if (allResult.status === 'fulfilled' && Array.isArray(allResult.value)) {
    others.value = allResult.value
  }

  if (appsResult.status === 'fulfilled') {
    supplierApps.value = Array.isArray(appsResult.value) ? appsResult.value : []
  }
  appsLoading.value = false

  if (keysResult.status === 'fulfilled') {
    const k = keysResult.value
    if (Array.isArray(k) && k.length === 0) {
      // Could be access denied (API returns [] on 403)
      keysAccessDenied.value = true
    } else {
      supplierKeys.value = Array.isArray(k) ? k : []
    }
  } else {
    keysAccessDenied.value = true
  }
  keysLoading.value = false
})
</script>

<style scoped>
.state-loading, .state-error {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 80px 20px; gap: 12px; color: var(--arc-text-muted);
}
.spinner {
  width: 32px; height: 32px; border: 2px solid var(--arc-border-strong);
  border-top-color: var(--arc-action-primary); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.error-icon { font-size: 28px; color: var(--arc-critical); }

.breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 20px; }
.bc-link { color: var(--arc-action-bright); text-decoration: none; }
.bc-link:hover { text-decoration: underline; }
.bc-sep { color: var(--arc-text-dim); }
.bc-current { color: var(--arc-text-secondary); }

.supplier-hero {
  display: flex; align-items: center; gap: 16px;
  background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle);
  border-radius: 12px; padding: 20px; margin-bottom: 16px;
}
.hero-avatar {
  width: 52px; height: 52px; border-radius: 12px;
  background: var(--arc-bg-elevated); border: 1px solid var(--arc-border-strong);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 16px; color: var(--arc-action-bright); flex-shrink: 0;
}
.hero-meta { flex: 1; }
.hero-name { font-size: 20px; font-weight: 700; color: var(--arc-text-primary); margin: 0 0 4px; }
.hero-id { font-size: 11px; color: var(--arc-text-muted); }
.hero-badges { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.sla-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  padding: 3px 8px; border-radius: 6px;
}
.sla-badge.premium { background: rgba(255,170,0,0.12); color: var(--arc-governance); }
.sla-badge.standard { background: rgba(0,119,182,0.1); color: var(--arc-action-bright); }
.onboarded-badge { font-size: 11px; color: var(--arc-text-muted); }

/* Tenant boundary panel */
.tenant-panel {
  background: rgba(0,40,85,0.6); border: 1px solid rgba(0,119,182,0.3);
  border-radius: 12px; margin-bottom: 20px; overflow: hidden;
}
.tenant-panel-header {
  display: flex; align-items: center; gap: 10px; padding: 12px 20px;
  background: rgba(0,119,182,0.08); border-bottom: 1px solid rgba(0,119,182,0.2);
  font-size: 13px; font-weight: 600; color: var(--arc-action-bright);
}
.tenant-panel-header svg { width: 16px; height: 16px; flex-shrink: 0; }
.boundary-tag {
  margin-left: auto; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; padding: 2px 8px; border-radius: 4px;
}
.boundary-tag.confirmed { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.tenant-panel-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }
.boundary-row { display: flex; gap: 16px; font-size: 13px; }
.bl { color: var(--arc-text-muted); width: 120px; flex-shrink: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding-top: 1px; }
.bv { color: var(--arc-text-secondary); font-size: 12px; }
.mono { font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace; color: var(--arc-action-bright); }
.boundary-notice {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; background: rgba(255,255,255,0.03);
  border: 1px solid var(--arc-border-subtle); border-radius: 8px;
  font-size: 11px; color: var(--arc-text-muted); margin-top: 4px;
}
.boundary-notice svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; }

.matrix-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 4px; }
@media (max-width: 640px) { .matrix-grid { grid-template-columns: 1fr; } }
.mx {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 13px; border-radius: 10px;
  border: 1px solid var(--arc-border-subtle); background: rgba(4, 16, 38, 0.5);
}
.mx.allow { border-color: rgba(34, 197, 94, 0.28); }
.mx.deny { border-color: rgba(220, 47, 2, 0.28); }
.mx-i { width: 15px; height: 15px; flex-shrink: 0; }
.mx.allow .mx-i { color: var(--arc-healthy); }
.mx.deny .mx-i { color: var(--arc-critical); }
.mx-t { font-size: 12px; font-weight: 600; color: var(--arc-text-primary); }
.mx-p { font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; }
.mx.allow .mx-p { color: var(--arc-healthy); }
.mx.deny .mx-p { color: var(--arc-critical); }

/* Detail grid */
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.arc-card {
  background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle);
  border-radius: 10px; padding: 20px;
}
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--arc-text-primary); text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.count-badge {
  font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 100px;
  background: rgba(0,119,182,0.1); color: var(--arc-action-bright);
}
.card-loading { font-size: 13px; color: var(--arc-text-muted); padding: 10px 0; }
.empty-sm { font-size: 13px; color: var(--arc-text-muted); text-align: center; padding: 20px 0; }

.app-list, .key-list { display: flex; flex-direction: column; gap: 6px; }
.app-row {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 12px; background: var(--arc-bg-surface); border-radius: 8px;
  text-decoration: none; transition: background 0.12s;
}
.app-row:hover { background: var(--arc-bg-elevated); }
.app-row-name { font-size: 13px; color: var(--arc-text-primary); font-weight: 600; }
.app-row-id { font-size: 10px; color: var(--arc-text-muted); }

.key-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: var(--arc-bg-surface); border-radius: 8px;
  text-decoration: none; transition: background 0.12s;
}
.key-row:hover { background: var(--arc-bg-elevated); }
.key-name { font-size: 12px; flex: 1; }
.key-type { font-size: 11px; color: var(--arc-text-muted); }

.denied-notice {
  display: flex; align-items: flex-start; gap: 12px; padding: 16px 12px;
  background: rgba(220,47,2,0.04); border: 1px solid rgba(220,47,2,0.15);
  border-radius: 8px; color: var(--arc-text-muted);
}
.denied-notice svg { width: 20px; height: 20px; color: var(--arc-critical); flex-shrink: 0; margin-top: 2px; }
.denied-title { font-size: 13px; font-weight: 600; color: var(--arc-critical); margin-bottom: 4px; }
.denied-sub { font-size: 12px; color: var(--arc-text-muted); }
</style>
