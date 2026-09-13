<script setup lang="ts">
// Prompt 31 — the CA chain and PKI roles have had a real API
// (GET /api/v1/pki/ca-chain, GET /api/v1/pki/roles) since early prompts,
// with zero UI surface — found live during a final review pass, the same
// "public material, no UI" shape as the key-download feature this page
// was built alongside. Both are genuinely public: a CA chain is meant to
// be distributed so anyone can validate a cert it signed.
import { apiErrorMessage } from '~/utils/apiError'
definePageMeta({ layout: 'default' })
useHead({ title: 'PKI' })
const api = useArcaniumApi()
const config = useRuntimeConfig()

const caChain = ref('')
const roles = ref<string[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const [chain, r] = await Promise.all([api.pkiCaChain(), api.pkiRoles()])
    caChain.value = chain
    roles.value = r
  } catch (e: unknown) {
    error.value = apiErrorMessage(e, 'Unable to load PKI configuration.')
  } finally {
    loading.value = false
  }
})

// Same same-origin /gateway proxy pattern as keys/[id].vue's public-key
// download — a plain link, not a fetch/blob, since the API's own
// Content-Disposition header already makes ?download=1 a real download.
const caChainDownloadUrl = computed(() => `${config.public.apiBase}/api/v1/pki/ca-chain?download=1`)
</script>

<template>
  <div>
    <section class="view-intro">
      <div>
        <p class="eyebrow">PUBLIC KEY INFRASTRUCTURE</p>
        <h2>PKI</h2>
        <p>
          The intermediate CA chain and certificate-issuance roles this
          estate's PKI engine exposes. Both are public material — meant to
          be shared, not secrets — the same way a browser ships a list of
          trusted root CAs.
        </p>
      </div>
    </section>

    <div v-if="loading" class="state-loading">Loading PKI configuration…</div>
    <div v-else-if="error" class="state-error" role="alert">{{ error }}</div>
    <template v-else>
      <div class="card">
        <div class="card-title-row">
          <span class="card-title">Intermediate CA chain</span>
          <a class="secondary-button" :href="caChainDownloadUrl" download>Download CA chain</a>
        </div>
        <pre class="pem-block">{{ caChain }}</pre>
      </div>

      <div class="card">
        <div class="card-title-row">
          <span class="card-title">Issuance roles</span>
          <span class="count">{{ roles.length }}</span>
        </div>
        <div v-if="!roles.length" class="state-empty">
          <p>No PKI issuance roles configured yet.</p>
        </div>
        <div v-else class="role-list">
          <span v-for="r in roles" :key="r" class="role-chip mono">{{ r }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.card { background: var(--arc-glass); border: 1px solid var(--arc-glass-border); border-radius: 12px; padding: 16px 18px; box-shadow: inset 0 1px 0 var(--arc-glass-hi); margin-bottom: 16px; }
.card-title-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--arc-text-muted); }
.count { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 100px; background: rgba(0,119,182,0.12); color: var(--arc-action-bright); }
.pem-block { font-family: ui-monospace, monospace; font-size: 11.5px; line-height: 1.5; color: var(--arc-text-secondary); background: rgba(4,16,38,0.5); border: 1px solid var(--arc-border-subtle); border-radius: 8px; padding: 14px; overflow-x: auto; white-space: pre; margin: 0; max-height: 320px; overflow-y: auto; }
.role-list { display: flex; flex-wrap: wrap; gap: 8px; }
.role-chip { font-size: 11.5px; padding: 4px 10px; border-radius: 100px; background: rgba(4,16,38,0.5); border: 1px solid var(--arc-border-subtle); color: var(--arc-action-bright); }
.mono { font-family: ui-monospace, monospace; }
</style>
