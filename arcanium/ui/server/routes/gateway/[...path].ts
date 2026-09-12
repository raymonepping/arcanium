// Transport only: a fixed upstream, allowlisted API paths and no Vault credentials.
export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path') || ''
  const read = /^(health|api\/v1\/(suppliers|applications|keys|approvals|evidence|cluster|pki|maturity|jobs|observability|keymgmt|platform|auth|integrations|reconciliation|controls|teams)(\/[a-zA-Z0-9_-]+)*(\/(applications|keys|summary|entitlements|me))?)$/.test(path)
  const write =
    (event.method === 'POST' && (
      /^api\/v1\/(approvals(\/[a-zA-Z0-9_-]+\/(approve|deny|authorize))?|suppliers|applications|keys|teams)$/.test(path)
      || /^api\/v1\/applications\/[a-f0-9-]+\/(provision|classify)$/.test(path)
      || /^api\/v1\/keys\/[a-zA-Z0-9_-]+\/(rotate|rewrap|destroy)$/.test(path)
      || /^api\/v1\/keymgmt\/[a-zA-Z0-9_.-]+\/(rotate|sync)$/.test(path)
      || /^api\/v1\/auth\/(logout|demo-persona)$/.test(path)
      // Prompt 20 — reconciliation sweep + governed actions.
      || /^api\/v1\/reconciliation\/run$/.test(path)
      || /^api\/v1\/reconciliation\/[a-zA-Z0-9_-]+\/(reconcile|accept-exception)$/.test(path)
    ))
    || (['PATCH', 'DELETE'].includes(event.method) && /^api\/v1\/(suppliers|applications|teams)\/[a-f0-9-]+$/.test(path))
    // Prompt 20 — editing the desired value itself (input/36's "who changed
    // the intent, when, why").
    || (event.method === 'PATCH' && /^api\/v1\/reconciliation\/desired-state\/[a-zA-Z0-9_-]+$/.test(path))
  if (!(event.method === 'GET' && read) && !write) {
    throw createError({ statusCode: 404, statusMessage: 'Route unavailable' })
  }
  if (write) {
    const origin = getHeader(event, 'origin')
    if (!origin || new URL(origin).host !== getHeader(event, 'host')) {
      throw createError({ statusCode: 403, statusMessage: 'Origin not permitted' })
    }
  }
  const target = new URL(path, `${useRuntimeConfig(event).arcaniumApiInternal.replace(/\/$/, '')}/`)
  target.search = getRequestURL(event).search
  setHeader(event, 'cache-control', 'no-store')
  const cookie = getHeader(event, 'cookie')
  // api/v1/auth/login and api/v1/auth/callback never actually reach this
  // catch-all in practice — the dedicated static routes under
  // gateway/api/v1/auth/{login,callback}.get.ts (relayOidcHop, Prompt 18)
  // take precedence in Nitro's router and handle the redirect/Set-Cookie
  // relay those two hops need. Don't duplicate that logic here.

  try {
    const r = await $fetch.raw(target.toString(), {
      method: event.method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
      body: ['POST', 'PATCH'].includes(event.method) ? await readBody(event) : undefined,
      headers: cookie ? { cookie } : undefined,
      timeout: 8000,
    })
    // Forward the session cookie the API sets (login / logout).
    const setCookie = r.headers.get('set-cookie')
    if (setCookie) appendResponseHeader(event, 'set-cookie', setCookie)
    return r._data
  } catch (error: unknown) {
    const code = (error as { statusCode?: number }).statusCode || 502
    // A degraded health response is useful data, but error payloads are never forwarded.
    const data = (error as { data?: { status?: string; vault?: { authenticated?: boolean }; database?: { reachable?: boolean }; request_id?: string } }).data
    if (path === 'health' && code === 503 && data?.status === 'degraded') {
      return { status: 'degraded', vault: { authenticated: !!data.vault?.authenticated }, database: { reachable: !!data.database?.reachable } }
    }
    // Prompt 24, Deliverable 2 — request_id is the one deliberate exception
    // to "error payloads are never forwarded": it's an opaque correlation
    // token, never sensitive, and apiError.ts / job & approval error toasts
    // need it to point back at the exact server-side log line. Most routes
    // 4xx/403 directly (authorize() checks scattered across every route
    // file) without going through errorHandler.js's JSON body — but
    // requestId middleware sets the X-Request-Id RESPONSE HEADER
    // unconditionally on every response, so that's the reliable fallback
    // when the body doesn't carry one.
    const headerRequestId = (error as { response?: { headers?: Headers } }).response?.headers?.get('x-request-id')
    const requestId = data?.request_id || headerRequestId || undefined
    throw createError({ statusCode: code, statusMessage: code === 401 ? 'Authentication required' : code === 403 ? 'Permission denied' : code === 409 ? 'Conflict: this record already exists, is in use, or was already resolved.' : code === 400 ? 'Invalid input. Check the supplied fields.' : code === 404 ? 'Resource unavailable' : 'Arcanium API unavailable', data: requestId ? { request_id: requestId } : undefined })
  }
})
