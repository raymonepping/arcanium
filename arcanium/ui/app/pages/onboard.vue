<template>
  <div class="onb">
    <section class="arc-hero onb-hero">
      <div>
        <p class="hero-eyebrow">Cryptographic onboarding</p>
        <h2 class="hero-title">Register a workload</h2>
        <p class="hero-sub">
          Tell Arcanium what the application needs. It translates that intent into
          Vault configuration — namespace, identity, policy, keys — and shows you
          exactly what it did.
        </p>
      </div>
      <div class="steps">
        <span v-for="(s, i) in stepNames" :key="s" class="step" :class="{ on: i === step, done: i < step }">
          <span class="step-n">{{ i + 1 }}</span>{{ s }}
        </span>
      </div>
    </section>

    <div class="onb-body">
      <div class="card">
        <!-- 1 · Service -->
        <template v-if="step === 0">
          <h3>Service / supplier tenant</h3>
          <label class="form-field">Supplier
            <select v-model="form.supplierMode">
              <option value="existing">Existing tenant</option>
              <option value="new">New tenant</option>
            </select>
          </label>
          <label v-if="form.supplierMode === 'existing'" class="form-field">Tenant
            <select v-model="form.supplierId">
              <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }} — {{ s.vault_namespace }}</option>
            </select>
          </label>
          <template v-else>
            <label class="form-field">Name<input v-model.trim="form.newSupplier.name" placeholder="wonka" pattern="[a-z0-9_-]+" /></label>
            <label class="form-field">Vault namespace<input v-model.trim="form.newSupplier.vault_namespace" :placeholder="`suppliers/${form.newSupplier.name || 'wonka'}`" /></label>
            <label class="form-field">SLA tier
              <select v-model="form.newSupplier.sla_tier"><option>standard</option><option>premium</option></select>
            </label>
            <p v-if="tenantNameTaken" class="field-error">A tenant named <code>{{ form.newSupplier.name }}</code> already exists — pick another name or choose it under "Existing tenant".</p>
          </template>
        </template>

        <!-- 2 · Application -->
        <template v-else-if="step === 1">
          <h3>Application</h3>
          <label class="form-field">Name<input v-model.trim="form.app.name" placeholder="golden-ticket-api" pattern="[a-z0-9_-]+" /></label>
          <label class="form-field">Description<input v-model.trim="form.app.description" placeholder="Handles card tokenisation" /></label>
          <div class="two">
            <label class="form-field">Environment
              <select v-model="form.app.environment"><option>production</option><option>staging</option><option>development</option></select>
            </label>
            <label class="form-field">Criticality
              <select v-model="form.app.criticality"><option>high</option><option>medium</option><option>low</option></select>
            </label>
          </div>
          <p v-if="appNameTaken" class="field-error">An application named <code>{{ form.app.name }}</code> already exists. Application names are unique across the estate — pick another.</p>
        </template>

        <!-- 3 · Requirements -->
        <template v-else-if="step === 2">
          <h3>Cryptographic requirements</h3>
          <p class="hint">Pick what this application does. Arcanium creates only what's needed. If both a symmetric and a signing need are checked, the workload gets one RSA-4096 key that does both.</p>
          <label class="check"><input type="checkbox" v-model="form.req.tls" /> TLS / X.509 certificates <span>PKI role, short-lived certs</span></label>
          <label class="check"><input type="checkbox" v-model="form.req.symmetric" /> Symmetric encryption <span>AES-256-GCM Transit key</span></label>
          <label class="check"><input type="checkbox" v-model="form.req.signing" /> Digital signatures <span>RSA-4096 Transit key</span></label>
          <label class="check"><input type="checkbox" v-model="form.req.asymmetric" /> Asymmetric encryption <span>RSA Transit key</span></label>
        </template>

        <!-- 4 · Custody -->
        <template v-else-if="step === 3">
          <h3>Key custody</h3>
          <label class="radio"><input type="radio" value="vault" v-model="form.custody" /> Vault software key <span>held in Vault's encrypted barrier, non-exportable</span></label>
          <label class="radio disabled"><input type="radio" value="softhsm" v-model="form.custody" disabled /> SoftHSM Managed Key <span>signing keys only — provisions on vault-hsm (see document-signing-key)</span></label>
          <label class="radio disabled"><input type="radio" value="external" v-model="form.custody" disabled /> External KMS <span>not configured</span></label>
        </template>

        <!-- 5 · Review -->
        <template v-else-if="step === 4">
          <h3>Review</h3>
          <p class="hint">The panel on the right is exactly what Arcanium will create. Nothing is provisioned until you press <strong>Provision</strong>.</p>
          <p v-if="error" class="inline-notice error" role="alert">{{ error }}</p>
        </template>

        <!-- 6 · Result -->
        <template v-else>
          <h3>{{ result?.status === 'succeeded' ? 'Provisioned' : 'Provisioning ' + (result?.status || 'failed') }}</h3>
          <div class="job-steps">
            <div v-for="(s, i) in result?.steps || []" :key="i" class="jstep" :class="s.status">
              <span class="jdot" :class="s.status" />{{ s.step }}
              <span v-if="s.detail && typeof s.detail === 'string'" class="jdetail">{{ s.detail }}</span>
            </div>
          </div>
          <p v-if="result?.error" class="inline-notice error" role="alert">{{ result.error }}</p>
          <div v-if="result?.status === 'succeeded'" class="done-links">
            <NuxtLink :to="`/applications/${appId}`" class="secondary-button">View application</NuxtLink>
            <NuxtLink to="/jobs" class="secondary-button">Jobs</NuxtLink>
          </div>
        </template>

        <div class="nav">
          <button v-if="step > 0 && step < 5" class="secondary-button" @click="step--">Back</button>
          <span class="grow" />
          <button v-if="step < 4" class="primary-button" :disabled="!canNext" @click="step++">Continue</button>
          <button v-else-if="step === 4" class="primary-button" :disabled="busy" @click="provision">
            {{ busy ? 'Provisioning…' : error ? 'Retry' : 'Provision' }}
          </button>
          <NuxtLink v-else to="/onboard" class="secondary-button" @click="reset">Onboard another</NuxtLink>
        </div>
      </div>

      <!-- Live provisioning preview -->
      <aside class="preview" :class="{ done: step === 5 }">
        <p class="pv-eyebrow">{{ step === 5 ? 'Provisioned' : 'Provisioning preview' }}</p>
        <p class="pv-lead">{{ step === 5 ? 'What Arcanium created:' : 'What Arcanium will create:' }}</p>

        <div class="pv-sec" :class="{ dim: step < 0 }">
          <span class="pv-k">Tenant</span>
          <div class="pv-v">
            <code>{{ nsPreview }}</code>
            <span class="pv-tag">{{ form.supplierMode === 'new' ? 'new — will be provisioned' : 'existing' }}</span>
          </div>
        </div>

        <div class="pv-sec" :class="{ dim: step < 1 || !form.app.name }">
          <span class="pv-k">Identity</span>
          <div class="pv-v"><code>{{ form.app.name || '—' }}{{ form.app.name ? '-workload' : '' }}</code> <span class="pv-tag">AppRole</span></div>
        </div>

        <div class="pv-sec" :class="{ dim: step < 2 }">
          <span class="pv-k">Crypto profile</span>
          <div class="pv-v pv-list">
            <span v-if="form.req.symmetric && !anyAsym">Transit · AES-256-GCM</span>
            <span v-if="anyAsym">Transit · RSA-4096 {{ form.req.symmetric ? '(symmetric + signing)' : '' }}</span>
            <span v-if="form.req.tls">PKI role · TLS certificates</span>
            <span v-if="!form.req.symmetric && !anyAsym && !form.req.tls" class="pv-none">— nothing selected yet</span>
          </div>
        </div>

        <div class="pv-sec" :class="{ dim: step < 3 }">
          <span class="pv-k">Custody</span>
          <div class="pv-v">{{ custodyLabel }}</div>
        </div>

        <div class="pv-sec" :class="{ dim: step < 4 }">
          <span class="pv-k">Vault resources</span>
          <ul class="pv-res">
            <li v-for="r in resourceRows" :key="r.label" :class="{ ok: r.status === 'succeeded', fail: r.status === 'failed' }">
              <span class="pv-res-mark">{{ resMark(r.status) }}</span>
              <span class="pv-res-l">{{ r.label }}</span>
              <code v-if="r.name" class="pv-res-n">{{ r.name }}</code>
            </li>
          </ul>
        </div>

        <div class="pv-sec" :class="{ dim: step < 4 }">
          <span class="pv-k">Governance</span>
          <div class="pv-v pv-list">
            <span>Auto-rotation · {{ ROTATION_DAYS }} days</span>
            <span>Destroy · approval required</span>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { Supplier, Application } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })
useHead({ title: 'Onboard' })

const ROTATION_DAYS = 30
const api = useArcaniumApi()
const stepNames = ['Service', 'Application', 'Requirements', 'Custody', 'Review', 'Result']
const step = ref(0)
const suppliers = ref<Supplier[]>([])
const apps = ref<Application[]>([])
const busy = ref(false)
const error = ref('')
const result = ref<{ status: string; steps?: { step: string; status: string; detail?: unknown }[]; error?: string | null } | null>(null)
const appId = ref('')

const form = reactive({
  supplierMode: 'existing' as 'existing' | 'new',
  supplierId: '',
  newSupplier: { name: '', vault_namespace: '', sla_tier: 'standard' },
  app: { name: '', description: '', environment: 'production', criticality: 'high' },
  req: { tls: true, symmetric: true, signing: false, asymmetric: false },
  custody: 'vault',
})

onMounted(async () => {
  const [s, a] = await Promise.allSettled([api.suppliers(), api.applications()])
  if (s.status === 'fulfilled' && Array.isArray(s.value)) {
    suppliers.value = s.value
    if (s.value[0]) form.supplierId = s.value[0].id
  }
  if (a.status === 'fulfilled' && Array.isArray(a.value)) apps.value = a.value
})

const anyAsym = computed(() => form.req.signing || form.req.asymmetric)
const keyType = computed(() => (anyAsym.value ? 'rsa-4096' : 'aes256-gcm96'))

const nsPreview = computed(() =>
  form.supplierMode === 'new'
    ? (form.newSupplier.vault_namespace || `suppliers/${form.newSupplier.name || 'wonka'}`)
    : suppliers.value.find(s => s.id === form.supplierId)?.vault_namespace || 'root',
)
const custodyLabel = computed(() =>
  form.custody === 'vault' ? 'Vault software key · non-exportable' : form.custody,
)

// ── Duplicate-name pre-checks (16.1) ───────────────────────────────────────
const tenantNameTaken = computed(() =>
  form.supplierMode === 'new'
  && !!form.newSupplier.name
  && suppliers.value.some(s => s.name.toLowerCase() === form.newSupplier.name.toLowerCase()),
)
const appNameTaken = computed(() =>
  !!form.app.name && apps.value.some(a => a.name.toLowerCase() === form.app.name.toLowerCase()),
)

const canNext = computed(() => {
  if (step.value === 0) {
    return form.supplierMode === 'existing'
      ? !!form.supplierId
      : /^[a-z0-9_-]+$/i.test(form.newSupplier.name) && !tenantNameTaken.value
  }
  if (step.value === 1) return /^[a-z0-9_-]+$/i.test(form.app.name) && !appNameTaken.value
  if (step.value === 2) return form.req.tls || form.req.symmetric || form.req.signing || form.req.asymmetric
  return true
})

// ── Resource rows — one source of truth for the preview + the review ───────
// Each row optionally carries a live `status` once the job has run.
const resourceRows = computed(() => {
  const ns = nsPreview.value
  const name = form.app.name || 'app'
  const rows: { label: string; name?: string; status?: string; match?: RegExp; alwaysDoneWithJob?: boolean }[] = []
  if (form.supplierMode === 'new') {
    // Provisioned by a separate supplier job — if the app job ran, this ran first.
    rows.push({ label: 'Namespace + AppRole + policy + transit + quota', name: ns, alwaysDoneWithJob: true })
  }
  rows.push({ label: 'Workload AppRole', name: `${name}-workload`, match: /approle/i })
  rows.push({ label: 'Least-privilege policy', name: `${name}-workload`, match: /policy/i })
  rows.push({ label: 'Transit key', name: `${name}-key · ${keyType.value}`, match: /transit key|key /i })
  if (form.req.tls) rows.push({ label: 'PKI role', name: `${name}-tls`, match: /pki/i })

  const jobSteps = result.value?.steps ?? []
  if (jobSteps.length) {
    for (const r of rows) {
      if (r.alwaysDoneWithJob) { r.status = 'succeeded'; continue }
      const hit = jobSteps.find(s => r.match?.test(s.step))
      r.status = hit?.status ?? 'skipped'
    }
  }
  return rows
})

function resMark(status?: string) {
  if (status === 'succeeded') return '✓'
  if (status === 'failed') return '✗'
  if (status === 'skipped') return '·'
  return step.value >= 4 ? '›' : '·'
}

async function provision() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  let supplierId = form.supplierId
  let createdSupplierThisRun = false
  try {
    if (form.supplierMode === 'new') {
      const s = await api.createSupplier({
        name: form.newSupplier.name,
        vault_namespace: form.newSupplier.vault_namespace || `suppliers/${form.newSupplier.name}`,
        sla_tier: form.newSupplier.sla_tier as Supplier['sla_tier'],
      })
      supplierId = s.id
      createdSupplierThisRun = true
    }

    const app = await api.createApplication({
      name: form.app.name,
      description: form.app.description,
      supplier_id: supplierId,
    })
    appId.value = app.id

    const caps: string[] = []
    if (form.req.symmetric) caps.push('encrypt', 'decrypt')
    if (anyAsym.value) caps.push('sign', 'verify')

    const r = await api.provisionApplication(app.id, {
      custody: form.custody,
      key_type: keyType.value,
      capabilities: caps,
      rotation_days: ROTATION_DAYS,
      tls: form.req.tls,
    })
    result.value = r.provisioning_job
    step.value = 5
  } catch (e: unknown) {
    let msg = apiErrorMessage(e, 'Provisioning failed.')
    // Roll back a tenant this run created so a failed onboarding never orphans a namespace.
    if (createdSupplierThisRun && supplierId) {
      try {
        await api.deleteSupplier(supplierId)
        msg += ` — the tenant "${form.newSupplier.name}" was rolled back.`
      } catch {
        msg += ` — the tenant "${form.newSupplier.name}" was created but could not be rolled back automatically; remove it from Suppliers.`
      }
    }
    error.value = msg
  } finally {
    busy.value = false
  }
}

function reset() {
  step.value = 0
  result.value = null
  error.value = ''
}
</script>

<style scoped>
.onb { display: flex; flex-direction: column; gap: 18px; }
.onb-hero { display: flex; gap: 28px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 460px; margin: 0; }
.steps { display: flex; flex-direction: column; gap: 4px; }
.step { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--arc-text-dim); }
.step.on { color: var(--arc-text-primary); }
.step.done { color: var(--arc-text-muted); }
.step-n { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--arc-border-strong); display: grid; place-items: center; font-size: 9px; }
.step.on .step-n { border-color: var(--arc-action-bright); color: var(--arc-action-bright); }
.step.done .step-n { background: var(--arc-healthy); border-color: var(--arc-healthy); color: #001; }

.onb-body { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 22px; align-items: start; }
@media (max-width: 900px) { .onb-body { grid-template-columns: 1fr; } }

.card { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 14px; padding: 22px; }
.card h3 { font-size: 15px; font-weight: 700; color: var(--arc-text-primary); margin: 0 0 14px; }
.hint { font-size: 12px; color: var(--arc-text-muted); margin: 0 0 14px; line-height: 1.6; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.check, .radio { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 10px 0; font-size: 13px; color: var(--arc-text-secondary); cursor: pointer; border-bottom: 1px solid var(--arc-border-subtle); }
.check span, .radio span { flex-basis: 100%; font-size: 11.5px; color: var(--arc-text-muted); padding-left: 24px; }
.radio.disabled { opacity: 0.45; cursor: not-allowed; }

.field-error { margin: 10px 0 0; font-size: 12px; color: var(--arc-critical); line-height: 1.5; }
.field-error code { font-family: ui-monospace, monospace; }

.job-steps { display: flex; flex-direction: column; gap: 6px; }
.jstep { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12.5px; color: var(--arc-text-secondary); }
.jdot { width: 7px; height: 7px; border-radius: 50%; background: var(--arc-text-dim); }
.jdot.succeeded { background: var(--arc-healthy); }
.jdot.failed { background: var(--arc-critical); }
.jstep.failed { color: var(--arc-critical); }
.jdetail { font-family: ui-monospace, monospace; font-size: 10.5px; color: var(--arc-text-dim); }
.done-links { display: flex; gap: 10px; margin-top: 16px; }

.nav { display: flex; align-items: center; gap: 10px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--arc-border-subtle); }
.grow { flex: 1; }

/* ── Preview panel ── */
.preview { position: sticky; top: 20px; background: rgba(0, 8, 24, 0.4); border: 1px solid var(--arc-glass-border); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
.preview.done { border-color: rgba(34, 197, 94, 0.35); }
.pv-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0; }
.preview.done .pv-eyebrow { color: var(--arc-healthy); }
.pv-lead { font-size: 12px; color: var(--arc-text-secondary); margin: 0; }
.pv-sec { display: flex; flex-direction: column; gap: 5px; padding-bottom: 12px; border-bottom: 1px solid var(--arc-border-subtle); transition: opacity 0.2s; }
.pv-sec:last-child { border-bottom: none; padding-bottom: 0; }
.pv-sec.dim { opacity: 0.4; }
.pv-k { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); }
.pv-v { font-size: 12px; color: var(--arc-text-secondary); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pv-v code, .pv-res-n { font-family: ui-monospace, monospace; font-size: 11px; color: var(--arc-info); }
.pv-tag { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 4px; background: rgba(0, 119, 182, 0.14); color: var(--arc-action-bright); }
.pv-list { flex-direction: column; align-items: flex-start; gap: 3px; }
.pv-none { color: var(--arc-text-dim); }
.pv-res { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.pv-res li { display: flex; align-items: baseline; gap: 7px; font-size: 11.5px; color: var(--arc-text-secondary); }
.pv-res-mark { color: var(--arc-text-dim); width: 10px; flex-shrink: 0; }
.pv-res li.ok .pv-res-mark { color: var(--arc-healthy); }
.pv-res li.fail { color: var(--arc-critical); }
.pv-res li.fail .pv-res-mark { color: var(--arc-critical); }
.pv-res-l { flex: 1; }
</style>
