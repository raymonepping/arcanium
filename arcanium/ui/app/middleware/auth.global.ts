// Prompt 14.5 — redirect to /login when auth is enabled and there is no session.
// When ARCANIUM_AUTH_ENABLED is unset, /auth/me returns { enabled: false } and
// this is a no-op.
//
// Prompt 18 fix (found live): this ran on the server via the bare global
// $fetch(), which — for a relative URL, during SSR — does not reliably use
// Nitro's internal same-process dispatch, and does not forward the incoming
// request's cookies at all. With ARCANIUM_AUTH_ENABLED left on for a
// sustained period for the first time (previously always off), every
// SSR render of every route — including the container healthcheck hitting
// `/` every 15s — went through this: an ever-401ing, never-actually-
// authenticated SSR check that behaved like a real outbound network call
// on each hit. That's what pegged CPU and grew memory to an OOM crash
// within minutes of every restart. useRequestFetch() is Nuxt's SSR-safe
// composable for calling your own server routes: it dispatches internally
// (no real socket round trip) and forwards the original request's headers,
// including the session cookie — fixing both the hang and a real
// correctness bug (SSR could never see a genuine session before this).
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  if (import.meta.server) {
    const requestFetch = useRequestFetch()
    try {
      const me = await requestFetch<{ enabled: boolean }>('/gateway/api/v1/auth/me')
      if (me?.enabled === false) return // auth disabled — open stack
    } catch (e: any) {
      if (e?.statusCode === 401 || e?.status === 401) {
        return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
      }
    }
    return
  }
  try {
    const me = await $fetch<{ enabled: boolean }>('/gateway/api/v1/auth/me')
    if (me?.enabled === false) return // auth disabled — open stack
  } catch (e: any) {
    if (e?.statusCode === 401 || e?.status === 401) {
      return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
    }
  }
})
