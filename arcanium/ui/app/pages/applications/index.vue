<template>
  <div>

    <!-- Filter bar -->
    <div class="filter-bar">
      <input
        v-model="search"
        class="filter-input"
        placeholder="Filter by name or ID…"
        type="search"
      />
      <select v-model="filterSupplier" class="filter-select">
        <option value="">All suppliers</option>
        <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <span class="result-count">{{ filtered.length }} application{{ filtered.length !== 1 ? 's' : '' }}</span>
    </div>

    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Loading applications…</span></div>
    <div v-else-if="error" class="state-error"><div class="error-icon">⚠</div><p>{{ error }}</p></div>
    <div v-else-if="!filtered.length" class="state-empty">
      <div class="empty-icon"><svg viewBox="0 0 48 48" fill="none"><rect x="8" y="6" width="32" height="36" rx="4" stroke="currentColor" stroke-width="1.5"/><line x1="16" y1="18" x2="32" y2="18" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="16" y1="24" x2="32" y2="24" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="16" y1="30" x2="24" y2="30" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div>
      <p class="empty-title">{{ search || filterSupplier ? 'No matches' : 'No applications' }}</p>
      <p class="empty-sub">{{ search || filterSupplier ? 'Try clearing filters.' : 'Applications will appear once registered.' }}</p>
    </div>

    <div v-else class="app-table-wrap">
      <table class="arc-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>ID</th>
            <th>Supplier</th>
            <th>Profiles</th>
            <th>Registered</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="a in paginated"
            :key="a.id"
            class="clickable-row"
            @click="navigateTo(`/applications/${a.id}`)"
          >
            <td class="app-name">{{ a.name }}</td>
            <td>
              <span :class="['cat-badge', `cat-${a.category ?? 'unscoped'}`]">
                {{ a.category ?? 'unscoped' }}
              </span>
            </td>
            <td><span class="mono">{{ a.id }}</span></td>
            <td>
              <NuxtLink v-if="supplierMap[a.supplier_id ?? '']" :to="`/suppliers/${a.supplier_id}`" class="supplier-link" @click.stop>
                {{ supplierMap[a.supplier_id ?? '']?.name }}
              </NuxtLink>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span v-if="a.crypto_profiles?.length" class="profile-count">{{ a.crypto_profiles.length }}</span>
              <span v-else class="muted">0</span>
            </td>
            <td class="muted">{{ formatDate(a.registered_at) }}</td>
          </tr>
        </tbody>
      </table>
      <RecordPagination v-model:page="page" :total="filtered.length" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { Application, Supplier } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })
useHead({ title: 'Applications' })

const { applications: fetchApplications, suppliers: fetchSuppliers } = useArcaniumApi()

const PER = 10
const loading = ref(true)
const error = ref('')
const apps = ref<Application[]>([])
const suppliers = ref<Supplier[]>([])
const search = ref('')
const filterSupplier = ref('')
const page = ref(1)

const supplierMap = computed(() =>
  Object.fromEntries(suppliers.value.map(s => [s.id, s]))
)

const filtered = computed(() => {
  let list = apps.value
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    list = list.filter(a => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
  }
  if (filterSupplier.value) {
    list = list.filter(a => a.supplier_id === filterSupplier.value)
  }
  return list
})
const paginated = computed(() => filtered.value.slice((page.value - 1) * PER, page.value * PER))
watch([search, filterSupplier], () => { page.value = 1 })

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

onMounted(async () => {
  const [appsResult, suppliersResult] = await Promise.allSettled([
    fetchApplications(),
    fetchSuppliers(),
  ])
  if (appsResult.status === 'fulfilled') {
    apps.value = Array.isArray(appsResult.value) ? appsResult.value : []
  } else {
    error.value = apiErrorMessage(appsResult.reason, 'Failed to load applications.')
  }
  if (suppliersResult.status === 'fulfilled') {
    suppliers.value = Array.isArray(suppliersResult.value) ? suppliersResult.value : []
  }
  loading.value = false
})
</script>

<style scoped>
.filter-bar {
  display: flex; align-items: center; gap: 12px; margin-bottom: 20px;
}
.filter-input, .filter-select {
  background: var(--arc-bg-surface); border: 1px solid var(--arc-border-subtle);
  border-radius: 8px; padding: 7px 12px; font-size: 13px; color: var(--arc-text-primary);
  font-family: inherit; outline: none; transition: border-color 0.12s;
}
.filter-input { flex: 1; min-width: 0; }
.filter-input:focus, .filter-select:focus { border-color: var(--arc-border-bright); }
.filter-select { color: var(--arc-text-secondary); }
.result-count { font-size: 13px; color: var(--arc-text-muted); flex-shrink: 0; }

.state-loading, .state-empty, .state-error {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; gap: 12px; color: var(--arc-text-muted);
}
.spinner { width: 32px; height: 32px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-icon { font-size: 28px; color: var(--arc-critical); }
.empty-icon { width: 56px; height: 56px; color: var(--arc-text-dim); }
.empty-icon svg { width: 100%; height: 100%; }
.empty-title { font-size: 16px; font-weight: 600; color: var(--arc-text-secondary); margin: 0; }
.empty-sub { font-size: 13px; color: var(--arc-text-muted); margin: 0; }

.app-table-wrap { background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 12px; overflow: hidden; }
.arc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.arc-table th {
  text-align: left; padding: 10px 16px; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted);
  border-bottom: 1px solid var(--arc-border-subtle); background: var(--arc-bg-shell);
}
.arc-table td { padding: 11px 16px; border-bottom: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.arc-table tr:last-child td { border-bottom: none; }
.clickable-row { cursor: pointer; transition: background 0.1s; }
.clickable-row:hover td { background: rgba(255,255,255,0.02); }
.app-name { font-weight: 600; color: var(--arc-text-primary) !important; }
.mono { font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace; font-size: 11px; color: var(--arc-action-bright); }
.muted { color: var(--arc-text-muted) !important; font-size: 12px; }
.supplier-link { color: var(--arc-action-bright); text-decoration: none; font-size: 12px; }
.supplier-link:hover { text-decoration: underline; }
.profile-count {
  font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 100px;
  background: rgba(0,119,182,0.1); color: var(--arc-action-bright);
}
.cat-badge {
  display: inline-block; font-size: 10px; font-weight: 600;
  padding: 1px 7px; border-radius: 10px; letter-spacing: 0.03em;
  text-transform: lowercase;
}
.cat-platform { background: rgba(124,134,152,0.15); color: var(--arc-text-muted); }
.cat-tenant   { background: rgba(0,119,182,0.15);  color: var(--arc-action-bright); }
.cat-unscoped { background: rgba(255,170,0,0.15);  color: var(--arc-governance); }
</style>
