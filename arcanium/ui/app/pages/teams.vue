<script setup lang="ts">
// Prompt 27, Deliverable 4 — team registry management. Operator-facing
// configuration (CRUD, gated by estate-wide `provision` server-side), not
// a user-facing feature — matches suppliers/index.vue's own CRUD pattern.
import type { Team, Supplier } from '~/types/arcanium'
import { apiErrorStatus } from '~/utils/apiError'
definePageMeta({ layout: 'default' })
useHead({ title: 'Teams' })
const api = useArcaniumApi()

const teams = ref<Team[]>([])
const suppliers = ref<Supplier[]>([])
const loading = ref(true); const error = ref(''); const notice = ref('')
const search = ref('')
const filtered = computed(() => teams.value.filter(t => `${t.name} ${t.description ?? ''}`.toLowerCase().includes(search.value.toLowerCase())))

const supplierName = (id: string) => suppliers.value.find(s => s.id === id)?.name ?? id

const mode = ref<'create' | 'edit' | 'delete' | null>(null)
const selected = ref<Team | null>(null)
const form = reactive({ name: '', description: '', supplier_ids: [] as string[], environments: '' })
const confirmation = ref(''); const saving = ref(false); const saveError = ref('')

async function load() {
  error.value = ''
  try {
    const [t, s] = await Promise.all([api.teams(), api.suppliers().catch(() => [])])
    teams.value = t
    suppliers.value = Array.isArray(s) ? s : []
  } catch (e: unknown) {
    error.value = apiErrorStatus(e) === 403
      ? 'Team management requires an estate-wide role (ciso/architect/operator/auditor) — a scoped or supplier-admin session cannot see this page.'
      : 'Unable to load teams. Check API availability and retry.'
  } finally { loading.value = false }
}
onMounted(load)

function open(action: 'create' | 'edit' | 'delete', team?: Team) {
  selected.value = team || null
  Object.assign(form, team
    ? { name: team.name, description: team.description ?? '', supplier_ids: team.supplier_ids ?? [], environments: (team.environments ?? []).join(', ') }
    : { name: '', description: '', supplier_ids: [], environments: '' })
  confirmation.value = ''; saveError.value = ''; mode.value = action
}

function toggleSupplier(id: string) {
  const i = form.supplier_ids.indexOf(id)
  if (i === -1) form.supplier_ids.push(id); else form.supplier_ids.splice(i, 1)
}

async function save() {
  if (saving.value) return
  saving.value = true; saveError.value = ''; notice.value = ''
  try {
    if (mode.value === 'delete' && selected.value) {
      if (confirmation.value !== selected.value.name) return
      await api.deleteTeam(selected.value.id)
      notice.value = 'Team removed.'
    } else {
      const body = {
        name: form.name,
        description: form.description || null,
        // Empty selection = null (covers every supplier — an estate-wide-
        // by-team audit grant), not an empty array (covers none) — an
        // operator building a team picks suppliers explicitly to narrow it.
        supplier_ids: form.supplier_ids.length ? form.supplier_ids : null,
        environments: form.environments.trim()
          ? form.environments.split(',').map(e => e.trim()).filter(Boolean)
          : null,
      }
      if (mode.value === 'edit' && selected.value) {
        await api.updateTeam(selected.value.id, body)
        notice.value = 'Team updated.'
      } else {
        await api.createTeam(body)
        notice.value = 'Team registered. Assign it via the OIDC group shown below on each member\'s account.'
      }
    }
    mode.value = null
    await load()
  } catch (e: unknown) {
    const code = apiErrorStatus(e)
    saveError.value = code === 409 ? 'That team name already exists.'
      : code === 400 ? 'Check the team name (letters, numbers, underscores, hyphens).'
      : 'Unable to save this change. Check API availability and try again.'
  } finally { saving.value = false }
}
</script>

<template>
  <div>
    <section class="view-intro">
      <div>
        <p class="eyebrow">CONTROL-PLANE MULTI-TENANCY</p>
        <h2>Teams</h2>
        <p>
          Links an OIDC group scope (<code>arcanium-&lt;role&gt;:team:&lt;name&gt;</code>) to
          concrete suppliers, so a scoped operator/auditor session sees only
          its own team's tenants — not a permission model change by itself,
          just the registry authorize() reads at request time.
        </p>
      </div>
      <button class="primary-button" @click="open('create')">＋ Create team</button>
    </section>

    <div class="filter-bar">
      <input v-model="search" type="search" aria-label="Search teams" placeholder="Search teams…" />
      <span>{{ filtered.length }} teams</span>
    </div>

    <p v-if="notice" class="inline-notice" role="status">{{ notice }}</p>

    <div v-if="loading" class="state-loading">Loading teams…</div>
    <div v-else-if="error" class="state-error" role="alert">{{ error }}<button class="secondary-button" @click="load">Retry</button></div>
    <div v-else-if="!filtered.length" class="state-empty">
      <h3>No teams registered</h3>
      <p>Create a team to scope an operator or auditor role to a subset of suppliers.</p>
    </div>
    <div v-else class="team-grid">
      <article v-for="t in filtered" :key="t.id" class="team-card">
        <div class="team-card-header">
          <h3>{{ t.name }}</h3>
          <span class="team-scope-badge">
            {{ t.supplier_ids === null ? 'all suppliers' : `${t.supplier_ids.length} supplier${t.supplier_ids.length === 1 ? '' : 's'}` }}
          </span>
        </div>
        <p v-if="t.description" class="team-desc">{{ t.description }}</p>
        <div class="team-suppliers">
          <span v-if="t.supplier_ids === null" class="team-chip team-chip--all">every supplier (estate-wide-by-team)</span>
          <span v-else-if="!t.supplier_ids.length" class="team-chip team-chip--empty">no suppliers assigned yet</span>
          <span v-for="sid in (t.supplier_ids ?? [])" :key="sid" class="team-chip">{{ supplierName(sid) }}</span>
        </div>
        <div v-if="t.environments?.length" class="team-envs">
          <span v-for="e in t.environments" :key="e" class="env-chip">{{ e }}</span>
        </div>
        <div class="team-group-box">
          <span>OIDC GROUP FOR THIS TEAM</span>
          <code>arcanium-&lt;role&gt;:team:{{ t.name }}</code>
          <small>e.g. <code>arcanium-operator:team:{{ t.name }}</code> or <code>arcanium-auditor:team:{{ t.name }}</code></small>
        </div>
        <div class="team-actions">
          <button class="secondary-button" :aria-label="`Edit ${t.name}`" @click="open('edit', t)">Edit</button>
          <button class="text-danger" :aria-label="`Delete ${t.name}`" @click="open('delete', t)">Delete</button>
        </div>
      </article>
    </div>

    <ManagementDialog
      :open="mode !== null"
      :title="mode === 'create' ? 'Create team' : mode === 'edit' ? 'Edit team' : 'Delete team'"
      :description="mode === 'delete' ? 'Remove a team registration.' : 'Define the team and which suppliers it covers.'"
      @update:open="value => { if (!value && !saving) mode = null }"
    >
      <form @submit.prevent="save">
        <template v-if="mode !== 'delete'">
          <label class="form-field">
            Team name
            <input v-model.trim="form.name" required maxlength="64" pattern="[a-zA-Z0-9_-]{1,64}" placeholder="e.g. platform" :disabled="mode === 'edit'" />
            <small>Letters, numbers, underscores and hyphens — matches the OIDC group name.</small>
          </label>
          <label class="form-field">
            Description
            <input v-model.trim="form.description" maxlength="256" placeholder="Optional" />
          </label>
          <label class="form-field">
            Environments (comma-separated)
            <input v-model.trim="form.environments" placeholder="e.g. production, staging (blank = all)" />
          </label>
          <fieldset class="form-field">
            <legend>Suppliers (blank = every supplier)</legend>
            <label v-for="s in suppliers" :key="s.id" class="supplier-check">
              <input type="checkbox" :checked="form.supplier_ids.includes(s.id)" @change="toggleSupplier(s.id)" />
              {{ s.name }} <code>{{ s.vault_namespace }}</code>
            </label>
            <p v-if="!suppliers.length" class="muted">No suppliers registered yet.</p>
          </fieldset>
        </template>
        <template v-else>
          <p>Delete <strong>{{ selected?.name }}</strong>? Any OIDC group referencing this team name will no longer resolve to any suppliers.</p>
          <label class="form-field">Type {{ selected?.name }} to confirm<input v-model="confirmation" required autocomplete="off" /></label>
        </template>
        <p v-if="saveError" class="inline-notice error" role="alert">{{ saveError }}</p>
        <div class="form-actions">
          <button type="button" class="secondary-button" :disabled="saving" @click="mode = null">Cancel</button>
          <button :class="mode === 'delete' ? 'destructive-button' : 'primary-button'" :disabled="saving || (mode === 'delete' && confirmation !== selected?.name)">
            {{ saving ? 'Saving…' : mode === 'delete' ? 'Delete team' : 'Save team' }}
          </button>
        </div>
      </form>
    </ManagementDialog>
  </div>
</template>

<style scoped>
.team-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; }
.team-card { border: 1px solid var(--arc-border-strong); border-radius: 14px; background: var(--arc-bg-card); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.team-card-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.team-card-header h3 { margin: 0; font-size: 18px; letter-spacing: -0.02em; color: var(--arc-text-primary); }
.team-scope-badge { font-size: 10.5px; font-weight: 700; padding: 2px 9px; border-radius: 100px; background: rgba(0,119,182,0.1); color: var(--arc-action-bright); white-space: nowrap; }
.team-desc { margin: 0; font-size: 12.5px; color: var(--arc-text-muted); }
.team-suppliers, .team-envs { display: flex; flex-wrap: wrap; gap: 6px; }
.team-chip { font-size: 11px; padding: 2px 9px; border-radius: 100px; background: rgba(4,16,38,0.5); border: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.team-chip--all { color: var(--arc-governance); border-color: var(--arc-pending-bg); }
.team-chip--empty { color: var(--arc-text-dim); font-style: italic; }
.env-chip { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 4px; background: rgba(72,202,228,0.1); color: var(--arc-info); }
.team-group-box { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px dashed var(--arc-border-strong); border-radius: 8px; }
.team-group-box span { font-size: 9.5px; letter-spacing: 0.1em; color: var(--arc-text-muted); }
.team-group-box code { font-size: 12px; color: var(--arc-info); }
.team-group-box small { font-size: 10.5px; color: var(--arc-text-muted); }
.team-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 4px; border-top: 1px solid var(--arc-border-subtle); }
.supplier-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 4px 0; }
.supplier-check code { font-size: 11px; color: var(--arc-text-muted); }
.muted { font-size: 12px; color: var(--arc-text-muted); }
</style>
