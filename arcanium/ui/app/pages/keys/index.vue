<template>
  <div class="keys">
    <section class="arc-hero keys-hero">
      <div>
        <p class="hero-eyebrow">Cryptographic inventory</p>
        <h2 class="hero-title">Keys &amp; custody</h2>
        <p class="hero-sub">
          Every key Arcanium can see, its algorithm, custody model and lifecycle posture.
          Private key material is never exposed here.
        </p>
      </div>
      <div class="keys-summary">
        <div><span>{{ allKeys.length }}</span>keys</div>
        <div><span>{{ signingCount }}</span>signing</div>
        <div><span>{{ protectedCount }}</span>protected</div>
      </div>
    </section>

    <div class="filter-bar">
      <input v-model="search" class="filter-input" placeholder="Filter by name, algorithm or capability…" type="search" aria-label="Filter keys" />
      <select v-model="filterKind" class="filter-select" aria-label="Filter by purpose">
        <option value="">All purposes</option>
        <option value="sign">Signing</option>
        <option value="encrypt">Encryption</option>
      </select>
      <span class="result-count">{{ filtered.length }} of {{ allKeys.length }}</span>
    </div>

    <div v-if="loading" class="state"><div class="spinner" /><span>Loading key inventory…</span></div>
    <div v-else-if="error" class="state err"><div class="err-ico">⚠</div><p>{{ error }}</p></div>
    <div v-else-if="!filtered.length" class="state">
      <p class="state-title">{{ search || filterKind ? 'No matching keys' : 'No keys found' }}</p>
      <p class="state-sub">{{ search || filterKind ? 'Clear the filters to see the full inventory.' : 'Transit and managed keys appear once configured in Vault.' }}</p>
    </div>

    <div v-else class="key-grid">
      <NuxtLink v-for="k in filtered" :key="k.name" :to="`/keys/${k.name}`" class="key-card" :style="{ 'view-transition-name': `key-${cssName(k.name)}` }">
        <div class="kc-head">
          <span class="kc-ico" :class="purpose(k)">
            <svg v-if="purpose(k) === 'sign'" viewBox="0 0 20 20" fill="none"><path d="M3 15c3-1 4-9 6-9s2 6 4 6 3-3 4-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            <svg v-else viewBox="0 0 20 20" fill="none"><rect x="5" y="9" width="10" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" stroke="currentColor" stroke-width="1.4"/></svg>
          </span>
          <span class="kc-name mono">{{ k.name }}</span>
          <span class="kc-arrow">→</span>
        </div>

        <div class="kc-meta">
          <div><span class="kc-l">Algorithm</span><span class="kc-v mono">{{ k.type }}</span></div>
          <div><span class="kc-l">Version</span><span class="kc-v">v{{ k.latest_version ?? k.versions ?? '—' }}</span></div>
          <div><span class="kc-l">Custody</span><span class="kc-v">{{ custody(k) }}</span></div>
          <div><span class="kc-l">Rotation</span><span class="kc-v">{{ (k.auto_rotate_period ?? 0) > 0 ? 'Automatic' : 'Manual' }}</span></div>
        </div>

        <div class="kc-tags">
          <span v-if="k.hsm_backed" class="tag hsm">HSM-backed</span>
          <span v-if="k.supports_signing" class="tag sign">Sign / Verify</span>
          <span v-if="k.supports_encryption" class="tag enc">Encrypt / Decrypt</span>
          <span v-if="k.exportable === false" class="tag ok">Non-exportable</span>
          <span v-else-if="k.exportable" class="tag warn">Exportable</span>
          <span v-if="k.deletion_allowed === false" class="tag ok">Delete-protected</span>
        </div>
      </NuxtLink>
    </div>

    <p class="foot-note">
      Custody shows how key material is held. HSM-backed managed keys and KMIP-managed keys
      surface here once provisioned; algorithm and custody are read from Vault, never inferred from names.
    </p>

    <!-- Key distribution (Prompt 14.3) -->
    <div class="dist">
      <div class="dist-head">
        <span class="dist-title">External Key Distribution</span>
        <span class="dist-badge" :class="km?.available ? 'ok' : 'off'">
          {{ km === null ? '…' : km.available ? 'Licensed' : 'Not licensed' }}
        </span>
      </div>
      <div v-if="km === null" class="dist-body muted">Checking Key Management engine…</div>
      <div v-else-if="!km.available" class="dist-body muted">{{ km.reason }}</div>
      <div v-else class="dist-body">
        <p class="dist-line"><strong>Pattern:</strong> Vault → external KMS (AWS KMS / Azure Key Vault / GCP Cloud KMS)</p>
        <p v-if="km.engine === 'not mounted'" class="dist-line muted">{{ km.hint }}</p>
        <template v-else>
          <div v-for="(k, i) in (km.keys as any[])" :key="i" class="dist-key">
            <span class="mono">{{ k.name }}</span>
            <span class="dist-arrow">→</span>
            <template v-if="k.distributed_to?.length">
              <span v-for="(t, j) in k.distributed_to" :key="j" class="dist-target">
                {{ t.provider }}
                <span v-if="t.emulated" class="dist-emu">emulated · LocalStack</span>
                <span class="dist-status" :class="t.status === 'unreachable' ? 'bad' : 'ok'">{{ t.status }}</span>
                <span class="muted">v{{ t.versions }}</span>
              </span>
            </template>
            <span v-else class="dist-target muted">no KMS provider configured</span>
          </div>
          <p v-if="km.note" class="dist-line muted">{{ km.note }}</p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { TransitKey } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })
useHead({ title: 'Key Inventory' })

const { keys: fetchKeys, keymgmt } = useArcaniumApi()
const loading = ref(true)
const error = ref('')
const allKeys = ref<TransitKey[]>([])
const search = ref('')
const filterKind = ref('')
const km = ref<any>(null)

function purpose(k: TransitKey) { return k.supports_signing ? 'sign' : 'encrypt' }
function custody(k: TransitKey) {
  // The API derives custody from Vault metadata (never inferred from the name).
  return (k as any).custody
    ?? (k.exportable ? 'Vault Transit · exportable' : 'Vault Transit (software)')
}
function cssName(n: string) { return n.replace(/[^a-z0-9]/gi, '-') }

const signingCount = computed(() => allKeys.value.filter(k => k.supports_signing).length)
const protectedCount = computed(() => allKeys.value.filter(k => k.deletion_allowed === false).length)

const filtered = computed(() => {
  let list = allKeys.value
  if (filterKind.value === 'sign') list = list.filter(k => k.supports_signing)
  if (filterKind.value === 'encrypt') list = list.filter(k => k.supports_encryption && !k.supports_signing)
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    list = list.filter(k =>
      k.name.toLowerCase().includes(q) ||
      k.type.toLowerCase().includes(q) ||
      (k.supports_signing && 'sign verify'.includes(q)) ||
      (k.supports_encryption && 'encrypt decrypt'.includes(q))
    )
  }
  return list
})

onMounted(async () => {
  try {
    const data = await fetchKeys()
    allKeys.value = Array.isArray(data) ? data : []
  } catch (e: unknown) {
    error.value = apiErrorMessage(e, 'Failed to load keys.')
  } finally {
    loading.value = false
  }
  try { km.value = await keymgmt() } catch { km.value = { available: false, reason: 'Key Management engine status unavailable.' } }
})
</script>

<style scoped>
.keys { display: flex; flex-direction: column; gap: 18px; }
.keys-hero { display: flex; gap: 28px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 460px; margin: 0; }
.keys-summary { display: flex; gap: 22px; }
.keys-summary div { display: flex; flex-direction: column; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); }
.keys-summary span { font-size: 24px; font-weight: 800; color: var(--arc-text-primary); font-variant-numeric: tabular-nums; }

.filter-bar { display: flex; align-items: center; gap: 10px; }
.filter-input, .filter-select {
  background: var(--arc-glass); border: 1px solid var(--arc-glass-border);
  border-radius: 8px; padding: 8px 12px; font-size: 13px; color: var(--arc-text-primary);
  font-family: inherit; outline: none; transition: border-color 0.14s;
}
.filter-input { flex: 1; min-width: 0; }
.filter-input:focus, .filter-select:focus { border-color: var(--arc-action-bright); }
.result-count { font-size: 12px; color: var(--arc-text-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }

.state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 70px 20px; gap: 10px; color: var(--arc-text-muted); }
.spinner { width: 30px; height: 30px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.err-ico { font-size: 26px; color: var(--arc-critical); }
.state-title { font-size: 15px; font-weight: 700; color: var(--arc-text-secondary); margin: 0; }
.state-sub { font-size: 12.5px; margin: 0; }

.key-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.key-card {
  background: var(--arc-glass); border: 1px solid var(--arc-glass-border);
  border-radius: 14px; padding: 16px 18px; text-decoration: none;
  display: flex; flex-direction: column; gap: 14px;
  box-shadow: inset 0 1px 0 var(--arc-glass-hi);
  transition: border-color 0.16s, transform 0.16s;
}
.key-card:hover { border-color: rgba(0, 180, 216, 0.4); transform: translateY(-3px); }
.kc-head { display: flex; align-items: center; gap: 10px; }
.kc-ico { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; flex-shrink: 0; border: 1px solid var(--arc-border-strong); }
.kc-ico.sign { color: var(--arc-info); background: rgba(72, 202, 228, 0.08); }
.kc-ico.encrypt { color: var(--arc-action-bright); background: rgba(0, 119, 182, 0.1); }
.kc-ico svg { width: 18px; height: 18px; }
.kc-name { flex: 1; font-size: 13px; color: var(--arc-text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kc-arrow { color: var(--arc-action-bright); font-size: 13px; }
.mono { font-family: ui-monospace, monospace; }

.kc-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.kc-meta > div { display: flex; flex-direction: column; gap: 1px; }
.kc-l { font-size: 9.5px; color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.kc-v { font-size: 12px; color: var(--arc-text-secondary); }

.kc-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 7px; border-radius: 5px; }
.tag.sign { background: rgba(72, 202, 228, 0.12); color: var(--arc-info); }
.tag.enc { background: rgba(0, 119, 182, 0.12); color: var(--arc-action-bright); }
.tag.ok { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.tag.warn { background: var(--arc-pending-bg); color: var(--arc-governance); }
.tag.hsm { background: rgba(255, 170, 0, 0.14); color: var(--arc-governance); border: 1px solid rgba(255, 170, 0, 0.3); }

.foot-note { font-size: 10.5px; color: var(--arc-text-dim); line-height: 1.5; max-width: 720px; margin: 0; }

.dist { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 12px; padding: 16px 18px; }
.dist-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.dist-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--arc-text-muted); }
.dist-badge { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 5px; }
.dist-badge.ok { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.dist-badge.off { background: rgba(125,133,151,0.12); color: var(--arc-text-muted); }
.dist-body { font-size: 12px; color: var(--arc-text-secondary); line-height: 1.6; }
.dist-line { margin: 0 0 6px; }
.dist-line.muted, .dist-body.muted { color: var(--arc-text-muted); font-size: 11.5px; }
.dist-key { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 12px; }
.dist-arrow { color: var(--arc-text-dim); }
.dist-target { color: var(--arc-text-secondary); display: inline-flex; align-items: center; gap: 6px; }
.dist-target.muted { color: var(--arc-text-dim); }
.dist-emu { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 4px; background: rgba(180,140,40,0.16); color: #b48c28; }
.dist-status { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 4px; }
.dist-status.ok { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.dist-status.bad { background: rgba(200,70,70,0.14); color: #c84646; }
</style>
