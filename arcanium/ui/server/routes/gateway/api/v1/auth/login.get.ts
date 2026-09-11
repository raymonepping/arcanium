// GET /gateway/api/v1/auth/login — the browser navigates here directly
// (window.location, not fetch). Express builds the Keycloak authorization
// URL and 302s; this route relays that redirect verbatim rather than
// letting Nitro's fetch quietly follow it server-side. Takes precedence
// over the [...path].ts catch-all for this exact path (static route beats
// catch-all in Nitro's router).
export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  return relayOidcHop(event, 'api/v1/auth/login')
})
