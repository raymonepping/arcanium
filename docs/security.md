# Security (Prompt 18 — Arcanium Security Foundation)

This document covers Arcanium's *own* application-security posture: how a
human authenticates, how mutations are authorized, and how the session is
protected. It does not cover Vault's cryptographic enforcement (namespaces,
policies, Sentinel, Control Groups) — see
[architecture.md](architecture.md) and [policy-as-code.md](policy-as-code.md)
for that; those boundaries are unchanged by this prompt.

## Trust model

```text
Human
   │ OIDC Authorization Code + PKCE
   ▼
Keycloak (OIDC broker, LDAP-federated)
   │ users / groups
   ▼
OpenLDAP (identity store — never a direct AuthN target for Arcanium)
```

```text
Browser
   │ session cookie only — no OIDC token, no Vault token
   ▼
Nuxt (same-origin gateway/BFF — relays two OIDC hops, proxies everything else)
   │
   ▼
Express (arcanium-api) — the confidential OIDC client AND session authority
   │
   ▼
Vault Enterprise — cryptographic enforcement (namespaces, policies, Sentinel, Control Groups)
```

**Express, not Nuxt, is the OIDC client.** An earlier draft of this design
put the OIDC exchange on the Nuxt server; that was corrected before
implementation (input/36) — Express already owns the `sessions` table and
`auth/index.js`, so the OIDC code exchange belongs there too, not split
across two processes. Nuxt's job stays exactly what it already was: a
same-origin relay that forwards a cookie and never touches credentials.

## What the browser never receives

- No OIDC access, ID, or refresh token.
- No Vault token.
- No LDAP credential.

Only an opaque, `HttpOnly` Arcanium session cookie. Verified by inspecting
actual network responses during testing (see
[scenarios/11_security_foundation/test_negative_auth.sh](../scenarios/11_security_foundation/test_negative_auth.sh)
and the Prompt 18 execution log in
[prompts/18_security_foundation.md](../prompts/18_security_foundation.md)),
not assumed from code review alone.

## Dual-hostname OIDC (why it's not `host.docker.internal`)

Keycloak needs to be reachable from two different places that cannot use the
same address:

- **The browser** (running on the host) reaches Keycloak at its published
  port — `KC_HOSTNAME` (e.g. `localhost:8083`).
- **Express** (running inside `arcanium-api`) reaches Keycloak over the
  container network — `http://keycloak:8080`.

The two reference projects this stack's identity layer was adapted from
(`workshop/zero_trust`, `Personal/vault_reference`) used
`host.docker.internal` for this — a Docker-Desktop-specific mechanism not
assumed to behave identically under this Podman machine. Arcanium instead
hand-configures both endpoint sets explicitly
(`ARCANIUM_OIDC_INTERNAL_URL` / `ARCANIUM_OIDC_PUBLIC_URL` /
`ARCANIUM_OIDC_ISSUER` in `.env`, consumed by `arcanium/api/src/auth/oidc.js`)
rather than relying on a single hostname resolving correctly from both
places. `KC_HOSTNAME` controls what Keycloak *stamps into tokens and
discovery documents* regardless of which network path was used to reach
it — that's what makes an internal-network fetch still validate against the
public issuer string.

## Authorization — deny-by-default

`arcanium/api/src/auth/authorize.js` is the **one** place mutation
permissions are decided. Every mutating route calls it; nothing else in the
API inline-checks `req.identity.persona` against a literal string.

> The UI may hide functionality. The API must forbid it.
> Button hidden ≠ authorization. API 403 = authorization.

| Persona        | Read | Provision | Rotate | Rewrap | Destroy request | Approve | Reconcile | Tenant   |
| -------------- | ---: | --------: | -----: | -----: | ---------------: | ------: | --------: | -------- |
| CISO           |    ✓ |         ✗ |      ✗ |      ✗ |                 ✓ |       ✓ |         ✗ | estate   |
| Architect      |    ✓ |         ✓ |      ✓ |      ✗ |                 ✓ |       ✗ |         ✓ | estate   |
| Operator       |    ✓ |         ✓ |      ✓ |      ✓ |                 ✓ |       ✗ |         ✓ | estate   |
| Auditor        |    ✓ |         ✗ |      ✗ |      ✗ |                 ✗ |       ✗ |         ✗ | estate   |
| Supplier Admin |    ✓ |   limited |limited |      ✗ |           limited |       ✗ |         ✗ | own only |

`Reconcile` (Prompt 20) shares its row with `Rotate` for every persona —
correcting drift back to a declared policy is operationally equivalent to
a rotate-class action.

Since Prompt 27, `authorize()` also takes an optional `env`/`team`
dimension: four of these roles (`ciso`, `architect`, `operator`,
`auditor`) can additionally be granted *scoped* — narrowed to one
environment or team rather than estate-wide — via LDAP/Keycloak groups
shaped `arcanium-<role>:env:<x>` or `arcanium-<role>:team:<x>`. This
table describes the estate-wide grant; see
[multitenancy.md](multitenancy.md) for the scoped-grant model, and
[external-integration.md](external-integration.md) for the separate
service-account (Bearer token) identity Prompt 28 added alongside human
OIDC sessions.

Wiring this in found and fixed two pre-existing gaps, not just formalised
existing behavior:
- `POST /api/v1/keys/:name/rewrap` previously allowed **both** `operator`
  and `architect` — the matrix says Architect is `✗` for rewrap. Now
  operator-only.
- `POST /api/v1/applications/:id/provision`, `POST /api/v1/applications`,
  and `POST /api/v1/suppliers` had no role check at all beyond the
  supplier-admin tenant boundary — a `ciso` or `auditor` session could
  previously provision. Now gated.

## Groups, not usernames

`config.js: auth.personaByUser` (a 6-entry hardcoded username→persona map)
is retired. Roles and tenant scope now derive from the OIDC `groups` claim
at session-creation time (`auth/authorize.js: groupsToIdentity()`):

```text
groups: ["arcanium-operator", "arcanium-tenant-pepsi"]
  → roles: ["operator"]
  → tenantScopes: ["suppliers/pepsi"]
```

`arcanium-supplier-admin` is its own explicit LDAP/Keycloak group — never
inferred from "has a tenant group and nothing else" (input/36), so a future
tenant-scoped role that isn't a supplier admin stays expressible.

## Session security

- Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
  - `Secure` is safe over the plain-HTTP local stack: browsers treat
    `http://localhost` and `http://127.0.0.1` as "potentially trustworthy"
    secure-context origins regardless of scheme (W3C Secure Contexts), which
    is the exclusive way this stack is accessed.
  - `SameSite=Lax`, not `Strict` — verified, not assumed: `Strict` cookies
    are not sent on the cross-site top-level navigation the browser makes
    when Keycloak redirects it back to the callback URL, which would break
    the round trip. The OIDC pending-flow cookie (state/nonce/PKCE verifier,
    10-minute TTL) uses the same reasoning.
- Absolute TTL: 1 hour. **Idle timeout: 30 minutes**, checked independently
  (`sessions.last_seen_at`, updated on every authenticated request) — a
  session left untouched is rejected before its absolute TTL elapses, not
  just at it.
- A forged or tampered session cookie fails outright: the cookie is an
  opaque random ID with no client-decodable structure, so there is nothing
  to tamper with usefully — any modification simply fails the `sessions`
  lookup and returns 401.

## CSRF

The gateway (`ui/server/routes/gateway/[...path].ts`) already validates the
`Origin` header against `Host` on every state-changing request and rejects a
mismatch with 403. Combined with `SameSite=Lax` cookies (which are not
attached to cross-site POST/PATCH/DELETE requests at all) and the fact that
the API is never reachable except through this one same-origin gateway (no
CORS headers are set anywhere — see `middleware/securityHeaders.js`), this
is the chosen CSRF defense: **Origin verification**, which OWASP lists as a
primary, sufficient CSRF mitigation for exactly this kind of same-origin
application — deliberately chosen over a double-submit or synchronizer
token, which would add a second mechanism without covering a gap the first
one leaves open.

## Security headers

Present on every response, both API (`middleware/securityHeaders.js`) and UI
(`nuxt.config.ts` `routeRules`):

- `Content-Security-Policy` — `default-src 'none'` on the API (it serves no
  content), `default-src 'self'; connect-src 'self'` on the UI. `script-src`
  on the UI carries `'unsafe-inline'` — found live, not by design: Nuxt/Vite
  emit an un-nonced inline `<script type="importmap">` plus a small inline
  bootstrap script, both required for client hydration. Without
  `'unsafe-inline'` a real browser blocks them outright and the app never
  hydrates (no client routing, no data fetches, effectively a dead page).
  Still same-origin only — no external script host is ever permitted. The
  correct long-term fix is a per-request nonce, which needs an extra
  module/wiring Nuxt doesn't provide out of the box; not done here.
- `Cache-Control: no-store` on every UI route except versioned static
  assets (`/_nuxt/**`, cached hard — filenames are content-hashed) —
  otherwise a browser can restore an old render via back-forward cache with
  no fresh request to the server at all, regardless of what the auth
  middleware would now do.
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- No `Access-Control-Allow-Origin` anywhere in the stack.

## Negative tests — the exit criterion

This prompt does not finish because OIDC login works. It finishes when
[scenarios/11_security_foundation/test_negative_auth.sh](../scenarios/11_security_foundation/test_negative_auth.sh)
proves its hostile assertions from `input/35` — anonymous access,
role-mismatched mutations, cross-tenant reads, forged/expired sessions, and
a rejected OIDC callback under a wrong state/issuer/audience. The suite has
grown well past its original 13 as later prompts added their own
authorization surface to prove against (29 assertions as of Prompt 28) —
run it and read its own output for the current count rather than trusting
a number in this document. See the
Prompt 18 execution log for the actual, current result of that run — this
document describes the design, the log records what was proven.

## What this prompt does not change

- Vault's own AppRole/userpass AuthN for **workloads** (payments-api,
  document-signing, etc.) — untouched, already correct
  ([input/16], `docs/architecture.md`).
- The Vault namespace boundary as the real cryptographic tenant isolation —
  persona scoping in Arcanium remains defense-in-depth on top of it, not a
  replacement for it (`docs/personas.md`).
