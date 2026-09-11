// GET /gateway/api/v1/auth/callback — this is the redirect_uri registered
// on the Keycloak client (must match ARCANIUM_API_CALLBACK_URL exactly).
// Keycloak redirects the browser's top-level navigation here with ?code=&
// state=; this route relays straight through to Express, which does the
// entire code exchange + validation + session creation server-side, then
// forwards Express's own Set-Cookie + redirect-to-/ back to the browser.
export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  return relayOidcHop(event, 'api/v1/auth/callback')
})
