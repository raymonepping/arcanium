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
      <p class="login-sub">Cryptographic control plane · sign in</p>

      <form @submit.prevent="submit">
        <label class="form-field">Username
          <input v-model.trim="username" autocomplete="username" required autofocus />
        </label>
        <label class="form-field">Password
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>
        <p v-if="error" class="inline-notice error">{{ error }}</p>
        <button class="primary-button" :disabled="busy" style="width:100%;justify-content:center">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p class="login-hint">
        Demo personas: <code>ciso</code> · <code>architect</code> · <code>operator</code> · <code>auditor</code>
      </p>
      <p class="login-note">
        Arcanium sign-in gates the management experience. Cross-tenant isolation is
        enforced by Vault Enterprise namespaces, not by this view.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import { apiErrorMessage, apiErrorStatus } from '~/utils/apiError'

definePageMeta({ layout: false })
useHead({ title: 'Sign in' })

const route = useRoute()
const router = useRouter()
const { login, me } = useArcaniumApi()

const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    const m = await me()
    if (m.enabled === false || m.user) router.replace(String(route.query.next || '/'))
  } catch { /* not signed in */ }
})

async function submit() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    await login(username.value, password.value)
    router.replace(String(route.query.next || '/'))
  } catch (e: unknown) {
    error.value = apiErrorStatus(e) === 401 ? 'Invalid credentials.' : apiErrorMessage(e, 'Sign-in failed.')
  } finally {
    busy.value = false
  }
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
form { display: flex; flex-direction: column; gap: 4px; }
.form-field input { width: 100%; }
.login-hint { font-size: 11px; color: var(--arc-text-muted); margin: 18px 0 0; }
.login-hint code { color: var(--arc-action-bright); }
.login-note { font-size: 10.5px; color: var(--arc-text-dim); line-height: 1.5; margin: 12px 0 0; }
</style>
