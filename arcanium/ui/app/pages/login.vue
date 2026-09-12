<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-brand">
        <svg class="brand-icon" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="#0096c7" stroke-width="1.2"/>
          <polygon points="12,5 17.5,8.5 17.5,15.5 12,19 6.5,15.5 6.5,8.5" stroke="#00b4d8" stroke-width="1" fill="none"/>
          <circle cx="12" cy="12" r="2" fill="#ffaa00"/>
        </svg>
        <span>Arcanium</span>
      </div>
      <p class="login-sub">Enterprise Cryptographic Control Plane</p>

      <p v-if="error" class="inline-notice error">{{ error }}</p>

      <button class="primary-button" :disabled="busy" style="width:100%;justify-content:center" @click="signIn">
        {{ busy ? 'Redirecting…' : 'Sign in' }}
      </button>

      <p class="login-note">
        Sign-in is handled by your organisation's identity provider (OIDC, LDAP-backed).
        Arcanium never sees your password — only a signed session once your identity
        provider confirms who you are. Cross-tenant isolation is enforced by Vault
        Enterprise namespaces, not by this view.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useArcaniumApi } from '~/composables/useArcaniumApi'

definePageMeta({ layout: false })
useHead({ title: 'Sign in' })

const route = useRoute()
const router = useRouter()
const { me } = useArcaniumApi()

const busy = ref(false)
const error = ref('')

onMounted(async () => {
  if (route.query.error) {
    error.value = 'Sign-in was rejected. Please try again.'
  }
  try {
    const m = await me()
    if (m.enabled === false || m.user) router.replace(String(route.query.next || '/'))
  } catch { /* not signed in */ }
})

// Prompt 18 — this is a full-page navigation, not a fetch/XHR call. The
// browser needs to actually leave localhost:3000 and land on Keycloak's
// authorization endpoint; a fetch() would just have Nuxt's server follow
// the redirect itself and hand back Keycloak's login-page HTML as if it
// were API data. See ui/server/routes/gateway/api/v1/auth/login.get.ts.
function signIn() {
  busy.value = true
  const next = typeof route.query.next === 'string' ? route.query.next : '/'
  window.location.href = `/gateway/api/v1/auth/login?next=${encodeURIComponent(next)}`
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh; display: grid; place-items: center; padding: 24px;
  background:
    radial-gradient(900px 520px at 78% -8%, rgba(0,119,182,0.20), transparent 60%),
    var(--arc-bg-canvas);
}
.login-card {
  width: min(400px, 100%);
  background: var(--arc-glass); border: 1px solid var(--arc-glass-border);
  border-radius: 16px; padding: 32px; box-shadow: var(--arc-shadow-lg);
  backdrop-filter: blur(14px);
}
.login-brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 750; color: var(--arc-text-primary); }
.brand-icon { width: 26px; height: 26px; }
.login-sub { font-size: 12px; color: var(--arc-text-muted); margin: 6px 0 22px; text-transform: uppercase; letter-spacing: 0.08em; }
/* Impeccable's live audit flagged this paragraph as low-contrast/tiny-text
   at 10.5px on --arc-text-dim (docs/frontend/UI_AUDIT.md); manual WCAG
   luminance math puts --arc-text-dim close to, but not safely above, the
   4.5:1 AA floor against this card's composited glass background — bumped
   to --arc-text-muted (already used one line up for .login-sub, no new
   color introduced) and 12px, the accessible-floor size the tool itself
   documents. */
.login-note { font-size: 12px; color: var(--arc-text-muted); line-height: 1.5; margin: 16px 0 0; }
.inline-notice.error { margin-bottom: 12px; }
</style>
