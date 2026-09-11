// oidcRelay.ts — Prompt 18. Relays a browser-facing OIDC hop through to
// Express without ever letting the Nuxt server "helpfully" follow the
// redirect itself (the default $fetch behavior, which would swallow the
// 302 and hand the browser Keycloak's login-page HTML as if it were an API
// response instead of actually navigating the browser there).
//
// Express (arcanium-api) is the OIDC client end-to-end (input/36) — this
// file does no OIDC logic of its own, it only relays: fetch Express with
// redirect:'manual', forward any Set-Cookie header, then re-issue Express's
// 3xx response as a real redirect to the browser.
import type { H3Event } from 'h3'

export async function relayOidcHop(event: H3Event, apiPath: string) {
  const target = new URL(apiPath, `${useRuntimeConfig(event).arcaniumApiInternal.replace(/\/$/, '')}/`)
  target.search = getRequestURL(event).search
  const cookie = getHeader(event, 'cookie')

  const r = await $fetch.raw(target.toString(), {
    method: 'GET',
    headers: cookie ? { cookie } : undefined,
    timeout: 8000,
    redirect: 'manual',
    ignoreResponseError: true,
  })

  const setCookie = r.headers.get('set-cookie')
  if (setCookie) appendResponseHeader(event, 'set-cookie', setCookie)

  const location = r.headers.get('location')
  if (location && r.status >= 300 && r.status < 400) {
    return sendRedirect(event, location, r.status as 301 | 302 | 303 | 307 | 308)
  }

  // Express didn't redirect (e.g. OIDC not configured, or a validation
  // error) — surface whatever it returned instead of pretending success.
  setResponseStatus(event, r.status || 502)
  return r._data
}
