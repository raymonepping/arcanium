# Authentication & personas (Prompt 18)

## Default: OFF

The Arcanium UI and API are open until `ARCANIUM_AUTH_ENABLED=true`. Flip that in
`.env` (and `ARCANIUM_DEMO_PERSONA_SWITCH=true` for presentations), then
`make identity-up && make identity-bootstrap && make arcanium-up`.

## Identity is authoritative in Keycloak, federated from OpenLDAP

Login is OIDC Authorization Code + PKCE against Keycloak
(`compose/identity/`), which authenticates against OpenLDAP as its identity
store. **OpenLDAP is never a direct authentication target for Arcanium**
(input/35) — Arcanium only ever talks to Keycloak, and only server-side.

```text
OpenLDAP (identity store)
   │ users / groups
   ▼
Keycloak (OIDC broker)
   │ Authorization Code + PKCE
   ▼
Express (arcanium-api) — confidential OIDC client + session authority
   │ session cookie only
   ▼
Nuxt gateway → Browser
```

Express mints a server-side session (opaque cookie, `sessions` table, 1h
absolute / 30m idle TTL). No password, OIDC token, or Vault token is ever
stored in the browser. See [security.md](security.md) for the full trust
model and the reasoning behind it.

## Personas derive from OIDC groups, not usernames

The Prompt 14.5 `config.js: auth.personaByUser` hardcoded username map is
retired. Roles and tenant scope now come from the OIDC `groups` claim
(`auth/authorize.js: groupsToIdentity()`):

| LDAP / Keycloak group | Role | Tenant scope |
|---|---|---|
| `arcanium-ciso` | ciso | estate |
| `arcanium-architect` | architect | estate |
| `arcanium-operator` | operator | estate |
| `arcanium-auditor` | auditor | estate |
| `arcanium-supplier-admin` + `arcanium-tenant-pepsi` | supplier-admin | `suppliers/pepsi` |
| `arcanium-supplier-admin` + `arcanium-tenant-cocacola` | supplier-admin | `suppliers/cocacola` |

`arcanium-supplier-admin` is its own explicit group — role and tenant scope
are two independent axes, not inferred from each other.

| UI emphasis | Can |
|---|---|
| ciso — posture · approvals · maturity | resolve approvals |
| architect — suppliers · keys · topology | provision, rotate |
| operator — jobs · approvals · cluster | provision, rotate, **rewrap** |
| auditor — evidence · maturity (read-only) | — |
| supplier-admin — scoped to their tenant | view own tenant only |

Mutation gates are now enforced centrally by `auth/authorize.js`, not
inline per-route (Prompt 18) — see [security.md](security.md) for the full
matrix and the two pre-existing gaps closing this actually found.

## Persona ≠ security boundary

Persona scoping in Arcanium is **defense in depth and UX**. A `pepsi-admin`
who bypasses Arcanium and calls Vault directly for a Coca-Cola path is still
stopped by the Vault namespace boundary (`input/16`). The login page says so.

## Demo persona switch

With `ARCANIUM_DEMO_PERSONA_SWITCH=true`, a signed-in user can `POST
/api/v1/auth/demo-persona {persona}` to move between CISO / Architect / Operator
views without re-login — for presentations only. This overrides the display
role for that session only; it does not touch the underlying OIDC identity
or group membership.

## Seed

```bash
./compose/identity/ldap/setup_ldap.sh   # loads the demo fixture into OpenLDAP
./compose/identity/keycloak/setup_keycloak.sh  # realm + federation + client
# or, together:
make identity-bootstrap
```

Demo accounts (POC passwords, printed by `setup_ldap.sh`, local lab only):
`demo-ciso`, `demo-architect`, `demo-operator`, `demo-auditor`,
`demo-pepsi`, `demo-cocacola`.
