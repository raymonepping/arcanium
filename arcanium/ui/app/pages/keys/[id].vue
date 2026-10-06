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
          <!-- Prompt 37 — strict equality, defensively: no live path
               reaches this page with deletion_allowed/exportable as
               anything but a real boolean today, but a truthiness check
               would render a FALSE "protected"/"non-exportable" claim
               for a genuinely unknown (null) state, were one ever to
               reach here (see the LIST route's own degraded-key
               fallback, which now returns null rather than leaving
               these undefined). -->
          <span class="kb" :class="keyData.deletion_allowed === true ? 'warn' : keyData.deletion_allowed === false ? 'ok' : 'unknown'">{{ keyData.deletion_allowed === true ? 'Deletion allowed' : keyData.deletion_allowed === false ? 'Delete-protected' : 'Protection unknown' }}</span>
          <span class="kb" :class="keyData.exportable === true ? 'warn' : keyData.exportable === false ? 'ok' : 'unknown'">{{ keyData.exportable === true ? 'Exportable' : keyData.exportable === false ? 'Non-exportable' : 'Exportability unknown' }}</span>
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
          <!-- Prompt 31 — only ever rendered for an asymmetric key's real
               public component; never present for a symmetric key like
               payments-api-key, not merely disabled. A plain same-origin
               link, not a fetch/blob: the API's Content-Disposition header
               already makes this a real browser download. -->
          <a
            v-if="keyData.has_public_key"
            class="secondary-button"
            :href="publicKeyUrl"
            download
          >Download public key</a>
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

      <p class="foot-note">Private key material is never returned by the Arcanium API — only the public half of an asymmetric key can ever be downloaded, and only when one exists.</p>
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
const { key, rotateKey, destroyKey, health } = useArcaniumApi()

const loading = ref(true)
const error = ref('')
const keyData = ref<TransitKey | null>(null)
// Prompt 37 — distinguishes "evidence ingestion is disabled for this
// deployment" from "this key has genuinely never been used" in the Use
// stage's note below; defaults true (the honest not-yet-observed wording)
// until /health actually says otherwise, never assumed false.
const evidenceIngestEnabled = ref(true)
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

// Prompt 31 — same /gateway same-origin proxy every other call in this
// composable uses (useArcaniumApi's $get base), built directly rather
// than through $get() since this is a real file download, not JSON.
const config = useRuntimeConfig()
const publicKeyUrl = computed(() => `${config.public.apiBase}/api/v1/keys/${encodeURIComponent(name)}/public-key`)

const stages = computed(() => {
  const k = keyData.value
  if (!k) return []
  return [
    // Prompt 37 — previously hardcoded "Created in Vault Transit" for
    // every key, including document-signing-key — a PKCS#11 Managed Key
    // on a different cluster, never actually a Vault Transit software
    // key. `on: true` is still correct for every key (a key that exists
    // was, by definition, generated somewhere) — only the note now
    // reflects where.
    { k: 'Generate', on: true, note: k.hsm_backed ? 'Created as a SoftHSM (PKCS#11) Managed Key' : 'Created in Vault Transit' },
    // Prompt 33 — previously hardcoded on: true for every key with a
    // never-checked generic claim. Now derived from a real
    // crypto_profiles join (distributionOf() in keys.js); null (not
    // false) for a platform key like document-signing-key, which is
    // consumed directly by a workload's own Terraform-provisioned policy
    // and was never modeled through applications/crypto_profiles at all.
    {
      k: 'Distribute',
      on: !!k.distribution,
      note: k.distribution
        ? `Provisioned to ${k.distribution.application} (${k.distribution.environment})`
        : "Not linked to a registered application's crypto profile",
    },
    { k: 'Store', on: true, note: k.hsm_backed ? 'Private key held in SoftHSM (PKCS#11)' : k.exportable ? 'Exportable custody' : 'Held in Vault, non-exportable' },
    // Prompt 33 — previously hardcoded on: false, always, for every key.
    // Now derived from the real ingested Vault audit log (usageOf() in
    // keys.js, backed by the `evidence` table) — the honest not-yet-
    // observed wording is unchanged for a key that genuinely has none.
    {
      k: 'Use',
      on: !!k.usage,
      note: k.usage
        ? `${k.usage.count} operation${k.usage.count === 1 ? '' : 's'} observed — most recent: ${k.usage.last_operation}`
        // Prompt 37 — previously this exact wording regardless of
        // whether ingestion is even enabled for this deployment, which
        // reads as "hasn't happened yet" when the real fact could be
        // "structurally cannot happen here at all."
        : evidenceIngestEnabled.value
          ? 'Operation evidence not yet ingested'
          : 'Operation evidence ingestion is disabled for this deployment',
    },
    { k: 'Rotate', on: (k.auto_rotate_period ?? 0) > 0 || (k.latest_version ?? 1) > 1, note: (k.auto_rotate_period ?? 0) > 0 ? 'Auto-rotation policy active' : (k.latest_version ?? 1) > 1 ? `${k.latest_version} versions` : 'No rotation yet' },
    { k: 'Destroy', on: false, note: k.deletion_allowed ? 'Deletion permitted' : 'Deletion protected' },
  ]
})

// Prompt 38 — previously read keyData.value.versions, expecting a
// { [version]: { creation_time } } object matching TransitKey's own
// declared type — but GET /keys/:name (resolveKeyMeta()) spreads
// Vault's raw response as-is, which has no `versions` field at all; the
// real per-version data is under Vault's own `keys` field. `versions`
// was always undefined here, so this card silently never rendered
// anything — the one place a human could visually confirm rotation
// actually happened. projectKey() (the LIST route)'s own `versions`
// field is a different thing entirely (a bare version count) and is
// untouched — this is a different route's different bug.
// Vault's own per-version entry shape differs by key type — found live
// while verifying this fix: a symmetric key's (aes256-gcm96) entry is a
// bare creation-time epoch NUMBER (seconds), never an object at all;
// only an asymmetric/managed key's entry is `{ creation_time, ... }`.
// The exact same quirk publicKeyOf() (keys.js) already has to handle for
// the same reason.
const versionList = computed(() => {
  if (!keyData.value?.keys) return []
  return Object.entries(keyData.value.keys)
    .map(([num, v]) => ({
      num: Number(num),
      creation_time: typeof v === 'number' ? new Date(v * 1000).toISOString() : v.creation_time,
    }))
    .sort((a, b) => b.num - a.num)
})

function cssName(n: string) { return n.replace(/[^a-z0-9]/gi, '-') }
function formatDate(ts: string) { return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function formatPeriod(secs: number) {
  const h = secs / 3600
  return h >= 24 ? `${Math.round(h / 24)} days` : `${Math.round(h)} hours`
}

onMounted(async () => {
  // Best-effort, non-blocking of the main key fetch below — a failed
  // health check should never prevent the key page itself from loading;
  // evidenceIngestEnabled just keeps its honest default (true) on failure.
  health().then((h) => {
    if (typeof h?.evidence?.ingestEnabled === 'boolean') {
      evidenceIngestEnabled.value = h.evidence.ingestEnabled
    }
  }).catch(() => {})
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
.crumb-sep { color: var(--arc-text-secondary); }
.crumb-cur { color: var(--arc-text-secondary); }
.mono { font-family: var(--font-mono); color: var(--arc-action-bright); font-size: 12px; }

.key-hero { display: flex; align-items: center; gap: 16px; }
.kh-ico { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; color: var(--arc-action-bright); border: 1px solid var(--arc-border-strong); background: color-mix(in srgb, var(--arc-hue-blue) 12%, transparent); flex-shrink: 0; }
.kh-ico svg { width: 28px; height: 28px; }
.kh-meta { flex: 1; min-width: 0; }
.kh-name { font-size: 17px; font-weight: 700; color: var(--arc-text-primary); margin: 0; }
.kh-sub { font-size: 12px; color: var(--arc-text-muted); }
.kh-badges { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.kb { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 5px; }
.kb.ok { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.kb.warn { background: var(--arc-pending-bg); color: var(--arc-governance); }
.kb.unknown { background: color-mix(in srgb, var(--arc-hue-slate) 12%, transparent); color: var(--arc-text-muted); }
.kb.hsm { background: color-mix(in srgb, var(--arc-hue-amber) 14%, transparent); color: var(--arc-governance); border: 1px solid color-mix(in srgb, var(--arc-hue-amber) 30%, transparent); }

.card { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 12px; padding: 16px 18px; box-shadow: inset 0 1px 0 var(--arc-glass-hi); }
.card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--arc-text-muted); margin-bottom: 12px; }
.card-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.card-title-row .card-title { margin: 0; }
.count { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 100px; background: color-mix(in srgb, var(--arc-hue-blue) 12%, transparent); color: var(--arc-action-bright); }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } }

.stage-strip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
@media (max-width: 720px) { .stage-strip { grid-template-columns: repeat(3, 1fr); } }
.stage { display: flex; flex-direction: column; gap: 5px; padding: 10px; border-radius: 9px; background: var(--arc-well); border: 1px solid var(--arc-border-subtle); }
.stage.on { border-color: color-mix(in srgb, var(--arc-hue-blue) 30%, transparent); background: linear-gradient(180deg, color-mix(in srgb, var(--arc-hue-blue) 14%, transparent), color-mix(in srgb, var(--arc-hue-blue) 3%, transparent)); }
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
.ver { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 8px; background: var(--arc-well); border: 1px solid var(--arc-border-subtle); font-size: 12.5px; }
.ver.latest { border-color: color-mix(in srgb, var(--arc-hue-blue) 30%, transparent); }
.ver-n { font-size: 11.5px; }
.ver-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 1px 6px; border-radius: 4px; background: color-mix(in srgb, var(--arc-hue-blue) 12%, transparent); color: var(--arc-action-bright); }
.ver-ts { margin-left: auto; font-size: 11px; color: var(--arc-text-muted); }

.foot-note { font-size: 10.5px; color: var(--arc-text-muted); margin: 0; }
.key-actions { display: flex; gap: 12px; align-items: center; }
.action-msg { font-size: 12px; color: var(--arc-action-bright); margin: 10px 0 0; line-height: 1.5; }
.action-note { font-size: 10.5px; color: var(--arc-text-muted); margin: 8px 0 0; line-height: 1.5; }
</style>
