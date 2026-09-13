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
  // Prompt 35 — found live with temporary debug logging on the server
  // branch: on a cold first request, useRequestFetch()'s internal dispatch
  // of '/gateway/api/v1/auth/me' does not always reach the h3 gateway
  // route directly — it can re-enter Nuxt's OWN SSR render pipeline for
  // that exact URL, which runs THIS SAME global middleware a second time
  // (a real, logged, nested invocation with to.fullPath the gateway URL
  // itself). That nested run correctly redirects internally, but its
  // redirect materializes as a small HTML stub body, which becomes the
  // *outer* requestFetch() call's "successful" (non-error) result —
  // `me` resolves to that HTML string instead of throwing a 401, so
  // `me?.enabled === false` is false and the OUTER middleware falls
  // through without redirecting. The real page then renders and ships
  // to the browser as a genuine 200 (confirmed via a live network
  // trace), and only the CLIENT branch's own $fetch — a real, correctly-
  // routed same-origin request, not an internal re-entrant one — catches
  // the 401 a moment later and redirects, producing the observed
  // "flash of the authenticated page, then hydration-mismatch, then
  // correct" symptom on first load.
  //
  // '/gateway/**' is an internal API-proxy prefix only — no page is ever
  // navigated to it — so this middleware never legitimately needs to run
  // for it. Exempting it here (same pattern as the existing '/login'
  // exemption) closes the recursive-reentry path entirely, regardless of
  // the exact Nitro-internal timing that causes it: a cheap prefix check,
  // no new network calls, no change to the redirect logic itself — the
  // "smallest justified fix" this file's own documented incident history
  // calls for.
  if (to.path.startsWith('/gateway/')) return
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
