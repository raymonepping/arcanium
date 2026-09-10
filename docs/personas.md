# Authentication & personas (Prompt 14.5)

## Default: OFF

The Arcanium UI and API are open until `ARCANIUM_AUTH_ENABLED=true`. Flip that in
`.env` (and `ARCANIUM_DEMO_PERSONA_SWITCH=true` for presentations), then
`make arcanium-up`.

## Identity is authoritative in Vault

Login goes to **Vault `auth/userpass/login/<user>`** — Vault validates the
credential. Arcanium mints a server-side session (opaque cookie, `sessions`
table, 1h TTL). No password or Vault token is stored in Arcanium.

Production note: swap `userpass` for **Vault OIDC** when an IdP is available. The
persona would then derive from Vault identity-group membership instead of the
POC username map.

## Personas

| User | Persona | UI emphasis | Can |
|---|---|---|---|
| `ciso` | ciso | posture · approvals · maturity | resolve approvals |
| `architect` | architect | suppliers · keys · topology | provision, rotate |
| `operator` | operator | jobs · approvals · cluster | provision, rotate, **rewrap** |
| `auditor` | auditor | evidence · maturity (read-only) | — |
| `pepsi-admin` / `cocacola-admin` | supplier-admin | scoped to their tenant | view own tenant only |

Mutation gates (API): only `operator`/`architect` may `provision`/`rotate`; only
`operator` may `rewrap`; `destroy` may be *requested* by anyone but *resolved*
only by `ciso`.

## Persona ≠ security boundary

Persona scoping in Arcanium is **defense in depth and UX**. A `pepsi-admin` who
bypasses Arcanium and calls Vault directly for a Coca-Cola path is still stopped
by the Vault namespace boundary (`input/16`). The login page says so.

## Demo persona switch

With `ARCANIUM_DEMO_PERSONA_SWITCH=true`, a signed-in user can `POST
/api/v1/auth/demo-persona {persona}` to move between CISO / Architect / Operator
views without re-login — for presentations only.

## Seed

```bash
./scripts/vault-seed-users.sh    # enables userpass + seeds the 6 demo users
```

Passwords are POC-only and printed in that script.
