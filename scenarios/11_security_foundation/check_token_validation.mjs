// check_token_validation.mjs — Prompt 18, assertions 12/13 ("wrong issuer",
// "wrong audience" → rejected).
//
// Runs the REAL client.authorizationCodeGrant() call path Express uses —
// this does not re-implement JWT/claims validation, it exercises the actual
// library call with a deliberately wrong Configuration against a REAL,
// freshly-issued authorization code from the live Keycloak realm.
//
// Two independent real exchanges are required because an authorization code
// is one-time-use: this script consumes one code per check.
//
// Known scope limit (documented, not hidden): the "wrong audience" check
// authenticates as a client_id that isn't registered at all, so Keycloak's
// own token endpoint rejects it at the CLIENT AUTHENTICATION step
// (invalid_client) rather than Arcanium's claims.aud comparison specifically
// ever running. That is still a real "present as a different client ->
// rejected" proof — a fully isolated claims.aud-only test would need a
// second REGISTERED confidential client, which this prompt does not
// provision (see Non-goals — not building a general-purpose IdP product).
//
// Usage:
//   node check_token_validation.mjs issuer   <code> <pkce_verifier> <redirect_uri>
//   node check_token_validation.mjs audience <code> <pkce_verifier> <redirect_uri>
// Relative path, not the bare specifier: this file lives outside
// arcanium/api, so Node's ESM resolver (which walks up node_modules from
// the FILE's own location, not the shell's cwd) would never find
// openid-client via a bare import here — found by actually running this.
import * as client from "../../arcanium/api/node_modules/openid-client/build/index.js";

const [mode, code, pkceVerifier, redirectUri] = process.argv.slice(2);
if (!["issuer", "audience"].includes(mode) || !code || !pkceVerifier || !redirectUri) {
  console.error(
    "usage: check_token_validation.mjs <issuer|audience> <code> <pkce_verifier> <redirect_uri>",
  );
  process.exit(2);
}

const REAL_ISSUER = process.env.ARCANIUM_OIDC_ISSUER;
const INTERNAL_URL = process.env.ARCANIUM_OIDC_INTERNAL_URL;
const CLIENT_ID = process.env.ARCANIUM_OIDC_CLIENT_ID;
const CLIENT_SECRET = process.env.ARCANIUM_OIDC_CLIENT_SECRET;
const REALM_PATH = "/realms/arcanium";

function metadata(issuer) {
  return {
    issuer,
    token_endpoint: `${INTERNAL_URL}${REALM_PATH}/protocol/openid-connect/token`,
    jwks_uri: `${INTERNAL_URL}${REALM_PATH}/protocol/openid-connect/certs`,
  };
}

const currentUrl = new URL(redirectUri);
currentUrl.searchParams.set("code", code);
// state isn't checked when `checks` below omits expectedState.

async function attempt(cfg, label) {
  client.allowInsecureRequests(cfg);
  try {
    await client.authorizationCodeGrant(cfg, currentUrl, {
      pkceCodeVerifier: pkceVerifier,
    });
    console.log(`${label}: NOT REJECTED — token exchange succeeded (unexpected)`);
    return false;
  } catch (err) {
    console.log(`${label}: rejected as expected — ${err.constructor.name}: ${err.message}`);
    return true;
  }
}

let rejected;
if (mode === "issuer") {
  const wrongIssuerCfg = new client.Configuration(
    metadata("http://wrong-issuer.invalid/realms/not-arcanium"),
    CLIENT_ID,
    CLIENT_SECRET,
  );
  rejected = await attempt(wrongIssuerCfg, "wrong issuer");
} else {
  const wrongAudienceCfg = new client.Configuration(
    metadata(REAL_ISSUER),
    "arcanium-not-a-real-client",
    "not-a-real-secret",
  );
  rejected = await attempt(wrongAudienceCfg, "wrong audience (unregistered client_id)");
}

process.exit(rejected ? 0 : 1);
