// Prompt 14.5 — redirect to /login when auth is enabled and there is no session.
// When ARCANIUM_AUTH_ENABLED is unset, /auth/me returns { enabled: false } and
// this is a no-op.

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  try {
    const me = await $fetch<{ enabled: boolean }>('/gateway/api/v1/auth/me')
    if (me?.enabled === false) return // auth disabled — open stack
  } catch (e: any) {
    if (e?.statusCode === 401 || e?.status === 401) {
      return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
    }
  }
})
