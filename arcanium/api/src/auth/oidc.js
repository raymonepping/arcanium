// auth/oidc.js — Prompt 18. The OIDC client itself (Authorization Code +
// PKCE against Keycloak). Express is the confidential client end-to-end
// (input/36) — nothing here ever runs in the browser or in Nuxt.
//
// Dual-hostname by design, not by accident: `internalUrl` (container
// network, e.g. http://keycloak:8080) is used for every server-to-server
// call this process makes. `publicUrl` (the published host port, e.g.
// http://localhost:8083) is used ONLY to build URLs the BROWSER is sent to
// (the authorization endpoint, the end-session endpoint). `issuer` must
// equal what Keycloak actually stamps into tokens via KC_HOSTNAME — that's
// what makes token validation succeed despite the two different hostnames.
import * as client from "openid-client";
import config from "../config.js";

const REALM_PATH = "/realms/arcanium";
const PENDING_COOKIE = "arc_oidc_pending";
const PENDING_TTL_S = 600; // 10 minutes to complete the round-trip at Keycloak

let oidcConfig = null;

function serverMetadata() {
  const { issuer, internalUrl, publicUrl } = config.oidc;
  return {
    issuer,
    authorization_endpoint: `${publicUrl}${REALM_PATH}/protocol/openid-connect/auth`,
    token_endpoint: `${internalUrl}${REALM_PATH}/protocol/openid-connect/token`,
    jwks_uri: `${internalUrl}${REALM_PATH}/protocol/openid-connect/certs`,
    userinfo_endpoint: `${internalUrl}${REALM_PATH}/protocol/openid-connect/userinfo`,
    end_session_endpoint: `${publicUrl}${REALM_PATH}/protocol/openid-connect/logout`,
    code_challenge_methods_supported: ["S256"],
  };
}

// Lazily built (and only if OIDC is actually configured) so a stack running
// with ARCANIUM_AUTH_ENABLED=false never touches this at all.
export function getOidcConfig() {
  if (!config.oidc.enabled) {
    throw new Error(
      "[oidc] ARCANIUM_AUTH_ENABLED is true but OIDC is not fully configured " +
        "(ARCANIUM_OIDC_ISSUER / _INTERNAL_URL / _PUBLIC_URL / _CLIENT_SECRET / API_CALLBACK_URL)",
    );
  }
  if (!oidcConfig) {
    oidcConfig = new client.Configuration(
      serverMetadata(),
      config.oidc.clientId,
      config.oidc.clientSecret,
    );
    // Local-lab HTTP only (no TLS termination in front of Keycloak in this
    // compose stack) — never set this in a deployment that terminates TLS.
    if (
      config.oidc.internalUrl.startsWith("http://") ||
      config.oidc.publicUrl.startsWith("http://")
    ) {
      client.allowInsecureRequests(oidcConfig);
    }
  }
  return oidcConfig;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// Pending-flow state travels in its own short-lived cookie — SameSite=Lax
// (not Strict: the browser lands here via a cross-site top-level navigation
// FROM Keycloak, which Strict cookies are not sent on). Never the session
// cookie's job, and never a bearer token — just enough to check the round
// trip that already happened is the one we started.
export function buildAuthorizationRedirect(returnTo = "/") {
  const cfg = getOidcConfig();
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();

  return client
    .calculatePKCECodeChallenge(codeVerifier)
    .then((codeChallenge) => {
      const url = client.buildAuthorizationUrl(cfg, {
        redirect_uri: config.oidc.callbackUrl,
        // No "groups" scope requested — found by actually running this: the
        // groups claim mapper is a client-level protocol mapper (created
        // directly on the client in setup_keycloak.sh, always applied to
        // every token this client receives), not gated behind a Keycloak
        // client scope. Requesting a "groups" scope that was never created
        // as an actual client scope makes Keycloak reject the whole
        // authorization request with invalid_scope.
        scope: "openid profile",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
        nonce,
      });
      const pending = Buffer.from(
        JSON.stringify({ state, nonce, codeVerifier, returnTo }),
      ).toString("base64url");
      return { url: url.toString(), pending };
    });
}

export function setPendingCookie(res, pending) {
  // Secure is safe here even over plain HTTP — same reasoning as the session
  // cookie in auth/index.js: this stack is exclusively accessed via
  // http://localhost / http://127.0.0.1, both "potentially trustworthy"
  // secure-context origins per the W3C spec, so browsers set and return
  // Secure cookies on them regardless of scheme. (A dropped-cookie failure
  // during /api-docs login was traced to the callback's relative redirect
  // landing on the wrong origin, not to this flag — see auth/index.js.)
  res.setHeader(
    "Set-Cookie",
    `${PENDING_COOKIE}=${pending}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${PENDING_TTL_S}`,
  );
}

export function clearPendingCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${PENDING_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

function readPending(req) {
  const raw = readCookie(req, PENDING_COOKIE);
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// Performs the full callback-side validation: state, PKCE, nonce, issuer,
// audience, signature and expiry are all enforced by
// client.authorizationCodeGrant()/tokens.claims() — this function does not
// re-implement JWT verification, it configures and calls the library that does.
export async function exchangeCode(req) {
  const pending = readPending(req);
  if (!pending) {
    const err = new Error("no pending OIDC flow (missing or expired cookie)");
    err.code = "NO_PENDING";
    throw err;
  }

  const cfg = getOidcConfig();

  // Reconstruct the URL AS KEYCLOAK KNOWS IT — the registered callback URL
  // (browser-facing, through the gateway) with this request's actual query
  // string appended. Express's own perceived request URL
  // (http://arcanium-api:3001/...) is never sent to Keycloak; using it here
  // would send the wrong redirect_uri to the token endpoint and Keycloak
  // would reject the exchange. openid-client derives redirect_uri from this
  // URL by stripping its query string, so this is the one thing that must
  // be exactly the registered URI, not the internal one.
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const currentUrl = new URL(config.oidc.callbackUrl + qs);

  const tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState: pending.state,
    expectedNonce: pending.nonce,
  });

  const claims = tokens.claims();
  return { claims, tokens, returnTo: pending.returnTo || "/" };
}

// Express does not retain the ID token server-side after mapping it onto
// the Arcanium session (nothing here needs it again) — RP-initiated logout
// at Keycloak works from `client_id` + `post_logout_redirect_uri` alone,
// per the OIDC RP-Initiated Logout 1.0 spec's alternative to id_token_hint.
export function buildLogoutUrl() {
  const cfg = getOidcConfig();
  const params = {
    client_id: config.oidc.clientId,
    post_logout_redirect_uri: config.oidc.baseUrl,
  };
  const url = client.buildEndSessionUrl(cfg, params);
  return url.toString();
}
