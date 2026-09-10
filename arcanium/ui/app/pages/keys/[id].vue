<template>
  <div class="keyd">
    <div v-if="loading" class="state"><div class="spinner" /><span>Loading key…</span></div>
    <div v-else-if="error" class="state err"><div class="err-ico">⚠</div><p>{{ error }}</p></div>
    <div v-else-if="keyData" class="keyd-body">
      <div class="crumb">
        <NuxtLink to="/keys" class="crumb-link">Keys</NuxtLink>
        <span class="crumb-sep">›</span>
        <span class="crumb-cur mono">{{ keyData.name }}</span>
      </div>

      <section class="arc-hero key-hero" :style="{ 'view-transition-name': `key-${cssName(keyData.name)}` }">
        <div class="kh-ico">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="12" r="6" stroke="currentColor" stroke-width="1.5"/><line x1="14" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="19" y1="12" x2="19" y2="16" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="22" y1="12" x2="22" y2="16" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </div>
        <div class="kh-meta">
          <h2 class="kh-name mono">{{ keyData.name }}</h2>
          <div class="kh-sub">{{ keyData.type }} · {{ custody }}</div>
        </div>
        <div class="kh-badges">
          <span v-if="keyData.hsm_backed" class="kb hsm">HSM-backed · Managed Key</span>
          <span class="kb" :class="keyData.deletion_allowed ? 'warn' : 'ok'">{{ keyData.deletion_allowed ? 'Deletion allowed' : 'Delete-protected' }}</span>
          <span class="kb" :class="keyData.exportable ? 'warn' : 'ok'">{{ keyData.exportable ? 'Exportable' : 'Non-exportable' }}</span>
        </div>
      </section>

      <!-- Key actions (Prompt 14.2) -->
      <div class="card">
        <div class="card-title">Key actions</div>
        <div class="key-actions">
          <button class="secondary-button" :disabled="!!busy" @click="doRotate">
            {{ busy === 'rotate' ? 'Rotating…' : 'Rotate key' }}
          </button>
          <button class="text-danger" :disabled="!!busy" @click="doDestroy">
            {{ busy === 'destroy' ? 'Requesting…' : 'Request destroy' }}
          </button>
        </div>
        <p v-if="actionMsg" class="action-msg">{{ actionMsg }}</p>
        <p class="action-note">
          Rotate runs immediately and is recorded as a job. Destroy is
          governance-gated — it records an approval request and never deletes
          synchronously.
        </p>
      </div>

      <!-- Lifecycle stage strip -->
      <div class="card">
        <div class="card-title">Lifecycle stage</div>
        <div class="stage-strip">
          <div v-for="st in stages" :key="st.k" class="stage" :class="{ on: st.on }">
            <span class="stage-dot" />
            <span class="stage-name">{{ st.k }}</span>
            <span class="stage-note">{{ st.note }}</span>
          </div>
        </div>
      </div>

      <div class="grid2">
        <div class="card">
          <div class="card-title">Properties</div>
          <div class="rows">
            <div class="r"><span>Algorithm</span><span class="mono">{{ keyData.type }}</span></div>
            <div class="r"><span>Latest version</span><span>v{{ keyData.latest_version ?? '—' }}</span></div>
            <div class="r"><span>Min decrypt version</span><span>{{ keyData.min_decryption_version }}</span></div>
            <div class="r"><span>Min encrypt version</span><span>{{ keyData.min_encryption_version }}</span></div>
            <div class="r"><span>Auto-rotation</span><span>{{ keyData.auto_rotate_period ? formatPeriod(keyData.auto_rotate_period) : 'Not configured' }}</span></div>
            <div class="r"><span>Custody</span><span>{{ custody }}</span></div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Capabilities</div>
          <div class="caps">
            <div class="cap" :class="{ on: keyData.supports_encryption }"><span>{{ keyData.supports_encryption ? '✓' : '—' }}</span>Encryption</div>
            <div class="cap" :class="{ on: keyData.supports_decryption }"><span>{{ keyData.supports_decryption ? '✓' : '—' }}</span>Decryption</div>
            <div class="cap" :class="{ on: keyData.supports_signing }"><span>{{ keyData.supports_signing ? '✓' : '—' }}</span>Signing / Verify</div>
            <div class="cap" :class="{ on: keyData.supports_derivation }"><span>{{ keyData.supports_derivation ? '✓' : '—' }}</span>Key derivation</div>
          </div>
          <div v-if="keyData.supports_signing" class="sign-note">
            Sign / verify and tamper-detection evidence surfaces here once workload
            operation ingestion is connected (Observability — upcoming).
          </div>
        </div>
      </div>

      <div v-if="versionList.length" class="card">
        <div class="card-title-row">
          <span class="card-title">Version history</span>
          <span class="count">{{ versionList.length }}</span>
        </div>
        <div class="vers">
          <div v-for="v in versionList" :key="v.num" class="ver" :class="{ latest: v.num === keyData.latest_version }">
            <span class="ver-n mono">v{{ v.num }}</span>
            <span v-if="v.num === keyData.latest_version" class="ver-badge">current</span>
            <span class="ver-ts">{{ formatDate(v.creation_time) }}</span>
          </div>
        </div>
      </div>

      <p class="foot-note">Private key material and secrets are never returned by the Arcanium API.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { TransitKey } from '~/types/arcanium'
import { apiErrorMessage, apiErrorStatus } from '~/utils/apiError'

definePageMeta({ layout: 'default' })

const route = useRoute()
const name = route.params.id as string
const { key, rotateKey, destroyKey } = useArcaniumApi()

const loading = ref(true)
const error = ref('')
const keyData = ref<TransitKey | null>(null)
const busy = ref('')
const actionMsg = ref('')

async function doRotate() {
  if (busy.value) return
  busy.value = 'rotate'; actionMsg.value = ''
  try {
    const r = await rotateKey(name)
    actionMsg.value = `Rotated — ${r.provisioning_job.steps[0]?.detail ?? 'done'}. See Jobs.`
    keyData.value = await key(name)
  } catch (e: unknown) {
    actionMsg.value = apiErrorMessage(e, 'Rotation failed.')
  } finally { busy.value = '' }
}
async function doDestroy() {
  if (busy.value) return
  busy.value = 'destroy'; actionMsg.value = ''
  try {
    const r = await destroyKey(name)
    actionMsg.value = `Destroy request recorded (approval ${r.approval.id.slice(0, 8)}). The key is NOT deleted until the approval is resolved.`
  } catch (e: unknown) {
    actionMsg.value = apiErrorMessage(e, 'Request failed.')
  } finally { busy.value = '' }
}

useHead({ title: computed(() => keyData.value?.name ?? 'Key') })

const custody = computed(() => {
  const k = keyData.value
  if (!k) return '—'
  return k.custody ?? (k.exportable ? 'Vault Transit · exportable' : 'Vault Transit (software)')
})

const stages = computed(() => {
  const k = keyData.value
  if (!k) return []
  return [
    { k: 'Generate', on: true, note: `Created in Vault Transit` },
    { k: 'Distribute', on: true, note: 'Reachable via AppRole-scoped policy' },
    { k: 'Store', on: true, note: k.hsm_backed ? 'Private key held in SoftHSM (PKCS#11)' : k.exportable ? 'Exportable custody' : 'Held in Vault, non-exportable' },
    { k: 'Use', on: false, note: 'Operation evidence not yet ingested' },
    { k: 'Rotate', on: (k.auto_rotate_period ?? 0) > 0 || (k.latest_version ?? 1) > 1, note: (k.auto_rotate_period ?? 0) > 0 ? 'Auto-rotation policy active' : (k.latest_version ?? 1) > 1 ? `${k.latest_version} versions` : 'No rotation yet' },
    { k: 'Destroy', on: false, note: k.deletion_allowed ? 'Deletion permitted' : 'Deletion protected' },
  ]
})

const versionList = computed(() => {
  if (!keyData.value?.versions) return []
  return Object.entries(keyData.value.versions)
    .map(([num, v]) => ({ num: Number(num), creation_time: v.creation_time }))
    .sort((a, b) => b.num - a.num)
})

function cssName(n: string) { return n.replace(/[^a-z0-9]/gi, '-') }
function formatDate(ts: string) { return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function formatPeriod(secs: number) {
  const h = secs / 3600
  return h >= 24 ? `${Math.round(h / 24)} days` : `${Math.round(h)} hours`
}

onMounted(async () => {
  try {
    keyData.value = await key(name)
  } catch (e: unknown) {
    error.value = apiErrorStatus(e) === 404 ? 'Key not found in Vault.' : apiErrorMessage(e, 'Failed to load key.')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.keyd-body { display: flex; flex-direction: column; gap: 16px; }
.state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 70px 20px; gap: 10px; color: var(--arc-text-muted); }
.spinner { width: 30px; height: 30px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.err-ico { font-size: 26px; color: var(--arc-critical); }

.crumb { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.crumb-link { color: var(--arc-action-bright); text-decoration: none; }
.crumb-link:hover { text-decoration: underline; }
.crumb-sep { color: var(--arc-text-dim); }
.crumb-cur { color: var(--arc-text-secondary); }
.mono { font-family: ui-monospace, monospace; color: var(--arc-action-bright); font-size: 12px; }

.key-hero { display: flex; align-items: center; gap: 16px; }
.kh-ico { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; color: var(--arc-action-bright); border: 1px solid var(--arc-border-strong); background: rgba(0, 119, 182, 0.12); flex-shrink: 0; }
.kh-ico svg { width: 28px; height: 28px; }
.kh-meta { flex: 1; min-width: 0; }
.kh-name { font-size: 17px; font-weight: 700; color: var(--arc-text-primary); margin: 0; }
.kh-sub { font-size: 12px; color: var(--arc-text-muted); }
.kh-badges { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.kb { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 5px; }
.kb.ok { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.kb.warn { background: var(--arc-pending-bg); color: var(--arc-governance); }
.kb.hsm { background: rgba(255, 170, 0, 0.14); color: var(--arc-governance); border: 1px solid rgba(255, 170, 0, 0.3); }

.card { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 12px; padding: 16px 18px; box-shadow: inset 0 1px 0 var(--arc-glass-hi); }
.card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--arc-text-muted); margin-bottom: 12px; }
.card-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.card-title-row .card-title { margin: 0; }
.count { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 100px; background: rgba(0,119,182,0.12); color: var(--arc-action-bright); }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } }

.stage-strip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
@media (max-width: 720px) { .stage-strip { grid-template-columns: repeat(3, 1fr); } }
.stage { display: flex; flex-direction: column; gap: 5px; padding: 10px; border-radius: 9px; background: rgba(4,16,38,0.5); border: 1px solid var(--arc-border-subtle); }
.stage.on { border-color: rgba(0,180,216,0.3); background: linear-gradient(180deg, rgba(0,119,182,0.14), rgba(0,119,182,0.03)); }
.stage-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--arc-text-dim); }
.stage.on .stage-dot { background: var(--arc-action-bright); box-shadow: 0 0 7px var(--arc-glow-blue); }
.stage-name { font-size: 11px; font-weight: 700; color: var(--arc-text-secondary); }
.stage.on .stage-name { color: var(--arc-text-primary); }
.stage-note { font-size: 9.5px; color: var(--arc-text-muted); line-height: 1.4; }

.rows { display: flex; flex-direction: column; gap: 8px; }
.r { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; }
.r span:first-child { color: var(--arc-text-muted); }
.r span:last-child { color: var(--arc-text-secondary); text-align: right; }

.caps { display: flex; flex-direction: column; gap: 8px; }
.cap { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--arc-text-muted); }
.cap.on { color: var(--arc-text-secondary); }
.cap span { width: 14px; flex-shrink: 0; }
.cap.on span { color: var(--arc-healthy); }
.sign-note { margin-top: 12px; font-size: 11px; color: var(--arc-text-muted); line-height: 1.5; padding-top: 12px; border-top: 1px solid var(--arc-border-subtle); }

.vers { display: flex; flex-direction: column; gap: 6px; }
.ver { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 8px; background: rgba(4,16,38,0.5); border: 1px solid var(--arc-border-subtle); font-size: 12.5px; }
.ver.latest { border-color: rgba(0,119,182,0.3); }
.ver-n { font-size: 11.5px; }
.ver-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 1px 6px; border-radius: 4px; background: rgba(0,119,182,0.12); color: var(--arc-action-bright); }
.ver-ts { margin-left: auto; font-size: 11px; color: var(--arc-text-muted); }

.foot-note { font-size: 10.5px; color: var(--arc-text-dim); margin: 0; }
.key-actions { display: flex; gap: 12px; align-items: center; }
.action-msg { font-size: 12px; color: var(--arc-action-bright); margin: 10px 0 0; line-height: 1.5; }
.action-note { font-size: 10.5px; color: var(--arc-text-dim); margin: 8px 0 0; line-height: 1.5; }
</style>
