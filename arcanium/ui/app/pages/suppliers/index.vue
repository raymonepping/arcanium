<script setup lang="ts">
import type { Supplier, Application } from '~/types/arcanium'
import { apiErrorStatus } from '~/utils/apiError'
definePageMeta({ layout: 'default' })
useHead({ title: 'Suppliers' })
const api = useArcaniumApi()
const suppliers = ref<Supplier[]>([])
const apps = ref<Application[]>([])
const isolation = ref<{ verified: boolean; checked_at?: string; directions?: any[]; note?: string | null; own_controls_ok?: boolean } | null>(null)
const loading = ref(true); const error = ref(''); const notice = ref('')
const search = ref(''); const tier = ref('')
const filtered = computed(() => suppliers.value.filter(s => `${s.name} ${s.vault_namespace}`.toLowerCase().includes(search.value.toLowerCase()) && (!tier.value || s.sla_tier === tier.value)))
const mode = ref<'create' | 'edit' | 'delete' | null>(null)
const selected = ref<Supplier | null>(null)
const form = reactive({ name: '', vault_namespace: '', sla_tier: 'standard' as Supplier['sla_tier'] })
const confirmation = ref(''); const saving = ref(false); const saveError = ref('')

const slaRate = (t: string) => (t === 'premium' ? '≈500 req/s' : '≈100 req/s')
const appCount = (id: string) => apps.value.filter(a => a.supplier_id === id).length
const boundaryTenants = computed(() =>
  suppliers.value.map(s => ({ ...s, apps: appCount(s.id) })),
)
const relCheck = computed(() => {
  if (!isolation.value?.checked_at) return 'just now'
  const m = Math.floor((Date.now() - new Date(isolation.value.checked_at).getTime()) / 60000)
  if (m < 1) return 'checked just now'
  if (m < 60) return `checked ${m}m ago`
  return `checked ${Math.floor(m / 60)}h ago`
})

async function load() {
  error.value = ''
  try {
    const [s, a] = await Promise.all([api.suppliers(), api.applications().catch(() => [])])
    suppliers.value = s
    apps.value = Array.isArray(a) ? a : []
  } catch { error.value = 'Unable to load suppliers. Check API availability and retry.' }
  finally { loading.value = false }
  api.supplierIsolation().then(r => { isolation.value = r }).catch(() => { isolation.value = null })
}
onMounted(load)
function open(action: 'create' | 'edit' | 'delete', supplier?: Supplier) {
  selected.value = supplier || null
  Object.assign(form, supplier ? { name: supplier.name, vault_namespace: supplier.vault_namespace, sla_tier: supplier.sla_tier } : { name: '', vault_namespace: '', sla_tier: 'standard' })
  confirmation.value = ''; saveError.value = ''; mode.value = action
}
async function save() {
  if (saving.value) return
  saving.value = true; saveError.value = ''; notice.value = ''
  try {
    if (mode.value === 'delete' && selected.value) {
      if (confirmation.value !== selected.value.name) return
      await api.deleteSupplier(selected.value.id)
      notice.value = 'Supplier removed and its Vault namespace de-provisioned.'
    } else if (mode.value === 'edit' && selected.value) {
      await api.updateSupplier(selected.value.id, { ...form })
      notice.value = 'Supplier updated.'
    } else {
      await api.createSupplier({ ...form })
      notice.value = 'Supplier registered — Vault namespace, AppRole, transit mount, policy and rate-limit quota provisioned. See Jobs.'
    }
    mode.value = null
    await load()
  } catch (e: unknown) {
    const code = apiErrorStatus(e)
    saveError.value = code === 409 ? mode.value === 'delete' ? 'This supplier is linked to applications or approval history. Reassign applications; suppliers with retained governance history cannot be deleted.' : 'That supplier name or namespace already exists.' : code === 400 ? 'Check the name, namespace and SLA tier.' : 'Unable to save this change. Check API availability and try again.'
  } finally { saving.value = false }
}
</script>
<template><div><section class="view-intro"><div><p class="eyebrow">TENANT MANAGEMENT</p><h2>Every supplier. Its own boundary.</h2><p>Register and manage the domains in your cryptographic estate.</p></div><button class="primary-button" @click="open('create')">＋ Create supplier</button></section><div class="filter-bar"><input v-model="search" type="search" aria-label="Search suppliers" placeholder="Search suppliers or namespaces…" /><select v-model="tier" aria-label="Filter SLA tier"><option value="">All SLA tiers</option><option>standard</option><option>premium</option></select><span>{{ filtered.length }} suppliers</span></div><p v-if="notice" class="inline-notice" role="status">{{ notice }}</p><section v-if="boundaryTenants.length >= 2" class="boundary-estate"><div class="be-head"><span class="be-eyebrow">Tenant isolation</span><span class="be-stamp" :class="isolation?.verified ? 'ok' : isolation === null ? 'checking' : 'untested'">{{ isolation?.verified ? '✓ Isolation verified' : isolation === null ? 'Checking…' : 'Not yet verified' }}</span></div><div class="be-row"><div v-for="(t, i) in boundaryTenants" :key="t.id" class="be-tenant-wrap"><NuxtLink :to="`/suppliers/${t.id}`" class="be-tenant"><code>{{ t.vault_namespace }}</code><span class="be-meta">{{ t.apps }} app{{ t.apps === 1 ? '' : 's' }} · {{ t.sla_tier }} · {{ slaRate(t.sla_tier) }}</span></NuxtLink><span v-if="i < boundaryTenants.length - 1" class="be-x" aria-hidden="true"><span>✕</span>cross access</span></div></div><p class="be-note">Each supplier is a separate Vault Enterprise namespace. <template v-if="isolation?.verified">A live bidirectional check ({{ isolation.directions?.filter(d => d.kind === 'cross-tenant').length }} cross-tenant reads) confirmed every cross-tenant read is denied — {{ relCheck }}.<template v-if="isolation.own_controls_ok === false"> Some tenants' own policies do not grant <code>list transit/keys</code> — a policy choice, not a breach.</template></template><template v-else-if="isolation?.note">{{ isolation.note }} Run <code>scenarios/06_supplier_isolation/</code> for the full proof.</template><template v-else>Boundary enforced by Vault; run <code>scenarios/06_supplier_isolation/</code> or open a tenant to see the access matrix.</template></p></section><div v-if="loading" class="state-loading">Loading supplier domains…</div><div v-else-if="error" class="state-error" role="alert">{{ error }}<button class="secondary-button" @click="load">Retry</button></div><div v-else-if="!filtered.length" class="state-empty"><h3>No suppliers found</h3><p>Create a supplier or adjust your filters.</p></div><div v-else class="supplier-grid"><article v-for="s in filtered" :key="s.id" class="supplier-card"><NuxtLink :to="`/suppliers/${s.id}`" class="supplier-main"><div class="supplier-card-header"><span class="supplier-avatar">{{ s.name.slice(0, 2).toUpperCase() }}</span><div><h3>{{ s.name }}</h3><span class="domain-caption">SUPPLIER DOMAIN</span></div><span class="sla-badge" :class="s.sla_tier">{{ s.sla_tier }}</span></div><div class="namespace-box"><span>VAULT NAMESPACE</span><code>{{ s.vault_namespace }}</code></div><div class="domain-bottom"><span>Registered {{ new Date(s.created_at).toLocaleDateString('en-GB') }}</span><span>Inspect domain ↗</span></div></NuxtLink><div class="supplier-actions"><button class="secondary-button" :aria-label="`Edit ${s.name}`" @click="open('edit', s)">Edit supplier</button><button class="text-danger" :aria-label="`Delete ${s.name}`" @click="open('delete', s)">Delete</button></div></article></div><p class="registry-note">Supplier management updates the Arcanium registry. Vault namespaces and their policies are provisioned separately; deleting a registry entry does not destroy Vault data.</p><ManagementDialog :open="mode !== null" :title="mode === 'create' ? 'Create supplier' : mode === 'edit' ? 'Edit supplier' : 'Delete supplier'" :description="mode === 'delete' ? 'Remove an unused supplier registration.' : 'Define the supplier and its Vault namespace reference.'" @update:open="value => { if (!value && !saving) mode = null }"><form @submit.prevent="save"><template v-if="mode !== 'delete'"><label class="form-field">Supplier name<input v-model.trim="form.name" required maxlength="128" pattern="[a-zA-Z0-9_-]{1,128}" placeholder="e.g. acme" /><small>Letters, numbers, underscores and hyphens.</small></label><label class="form-field">Vault namespace<input v-model.trim="form.vault_namespace" required maxlength="256" pattern="[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*" placeholder="suppliers/acme" /><small>Reference an existing or separately provisioned namespace.</small></label><label class="form-field">SLA tier<select v-model="form.sla_tier"><option>standard</option><option>premium</option></select></label></template><template v-else><p>Delete <strong>{{ selected?.name }}</strong> from the registry? Linked applications or approval history prevent deletion.</p><label class="form-field">Type {{ selected?.name }} to confirm<input v-model="confirmation" required autocomplete="off" /></label></template><p v-if="saveError" class="inline-notice error" role="alert">{{ saveError }}</p><div class="form-actions"><button type="button" class="secondary-button" :disabled="saving" @click="mode = null">Cancel</button><button :class="mode === 'delete' ? 'destructive-button' : 'primary-button'" :disabled="saving || (mode === 'delete' && confirmation !== selected?.name)">{{ saving ? 'Saving…' : mode === 'delete' ? 'Delete supplier' : 'Save supplier' }}</button></div></form></ManagementDialog></div></template>
<style scoped>
.supplier-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:20px}.supplier-card{border:1px solid var(--arc-border-strong);border-radius:16px;background:var(--arc-bg-card);overflow:hidden;max-width:640px;transition:transform .2s,border-color .2s}.supplier-card:hover{transform:translateY(-3px);border-color:var(--arc-action-primary)}.supplier-main{display:block;padding:26px;color:var(--arc-text-primary)}.supplier-card-header{display:flex;align-items:center;gap:15px}.supplier-avatar{display:grid;place-items:center;width:52px;height:52px;border-radius:14px;border:1px solid var(--arc-action-primary);background:linear-gradient(140deg,var(--arc-bg-surface),var(--arc-bg-card));color:var(--arc-info);font-size:19px}.supplier-card h3{margin:0;font-size:22px;letter-spacing:-.03em}.domain-caption{font-size:9px;letter-spacing:.16em;color:var(--arc-text-muted)}.sla-badge{margin-left:auto;border:1px solid var(--arc-border-strong);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--arc-text-secondary)}.namespace-box{margin:25px 0;display:flex;flex-direction:column;gap:8px;padding:18px;border:1px dashed var(--arc-border-strong);border-radius:10px}.namespace-box span{font-size:10px;letter-spacing:.1em;color:var(--arc-text-muted)}.namespace-box code{font-size:13px;color:var(--arc-info);overflow-wrap:anywhere}.domain-bottom{display:flex;justify-content:space-between;gap:15px;font-size:11px;color:var(--arc-text-muted)}.domain-bottom span:last-child{color:var(--arc-info)}.supplier-actions{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;border-top:1px solid var(--arc-border-subtle);background:#0001}.registry-note{margin-top:25px;max-width:850px;font-size:12px;color:var(--arc-text-muted)}

/* Estate isolation boundary (Prompt 16.2) */
.boundary-estate{margin:18px 0 24px;padding:18px 20px;border:1px solid var(--arc-glass-border);border-radius:14px;background:rgba(0,8,24,.4)}
.be-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.be-eyebrow{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--arc-action-bright)}
.be-stamp{font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;letter-spacing:.03em}
.be-stamp.ok{background:var(--arc-healthy-bg);color:var(--arc-healthy)}
.be-stamp.untested{background:var(--arc-pending-bg);color:var(--arc-governance)}
.be-stamp.checking{background:rgba(125,133,151,.14);color:var(--arc-text-muted)}
.be-row{display:flex;align-items:stretch;flex-wrap:wrap;gap:0}
.be-tenant-wrap{display:flex;align-items:center;gap:0}
.be-tenant{display:flex;flex-direction:column;gap:5px;padding:14px 18px;border:1px solid var(--arc-border-strong);border-radius:10px;background:var(--arc-bg-card);color:var(--arc-text-primary);min-width:180px}
.be-tenant:hover{border-color:var(--arc-action-primary)}
.be-tenant code{font-family:ui-monospace,monospace;font-size:12px;color:var(--arc-info)}
.be-meta{font-size:10.5px;color:var(--arc-text-muted)}
.be-x{display:flex;flex-direction:column;align-items:center;gap:2px;padding:0 16px;font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--arc-critical)}
.be-x span{font-size:15px;font-weight:800;line-height:1}
.be-note{margin:14px 0 0;font-size:11.5px;color:var(--arc-text-muted);line-height:1.6}
.be-note code{font-family:ui-monospace,monospace;color:var(--arc-text-secondary)}
@media(max-width:640px){.be-row{flex-direction:column}.be-tenant-wrap{flex-direction:column;width:100%}.be-tenant{width:100%}.be-x{padding:10px 0}}
</style>
