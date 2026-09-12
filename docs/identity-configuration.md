# Identity configuration — scoped roles (Prompt 27)

A concrete walkthrough for provisioning the `env`/`team`-scoped group
naming convention Prompt 27 adds on top of the base role model already
documented in [`docs/personas.md`](personas.md) and
[`docs/security.md`](security.md). Read those first if you haven't —
this document only covers what's new: env/team scope dimensions,
orthogonal to the existing role and tenant-scope axes.

## The group naming convention

```text
arcanium-<role>                    existing — estate-wide role (unchanged)
arcanium-tenant-<namespace>        existing — supplier-admin tenant scope (unchanged)

arcanium-<role>:env:<env>          new — role restricted to one environment
arcanium-<role>:team:<team>        new — role restricted to one team's suppliers
```

`<role>` is one of `ciso`, `architect`, `operator`, `auditor` —
**deliberately not** `supplier-admin` (see `docs/personas.md`'s own
"Persona ≠ security boundary" section and this prompt's design rule: the
supplier-admin role is unchanged, this prompt scopes operator- and
audit-side roles, not supplier-side ones). `<env>`/`<team>` are free-text
tags — `production`, `staging`, `dev`, or a team name like `platform` —
matched against `applications.environment` (Deliverable 3) and the
`teams` registry (Deliverable 2) respectively.

An identity can hold **multiple** scoped groups for the same role — e.g.
both `arcanium-operator:env:staging` and `arcanium-operator:env:production`
— which merge into one scoped grant covering both environments (see
`groupsToIdentity()`'s own comment in `auth/authorize.js`). An identity
can also combine an estate-wide role with a scoped one for a *different*
role — see the combining example at the end of this document.

## Provisioning a scoped group in Keycloak

Prompt 18's existing setup (`compose/identity/keycloak/setup_keycloak.sh`)
already configures the LDAP-backed group federation and the `groups`
claim mapper — nothing about that pipeline changes for scoped groups.
Group names simply flow through as literal `cn` values, colons included;
Keycloak does not interpret the `:role:env:value` structure specially,
and neither does the group-membership OIDC mapper (`full.path=false`, so
the claim carries the bare group name, not an LDAP DN).

To create a scoped group **directly in Keycloak's admin console**
(equivalent to the LDAP path below, if your deployment manages groups in
Keycloak rather than federating them):

1. **Groups → Create group** — name it exactly `arcanium-operator:env:production`
   (or whichever role/dimension/value you need). Keycloak group names
   accept colons without escaping.
2. **Users → (the target user) → Groups → Join Group** — add them to
   the group you just created.
3. No client scope or protocol mapper changes are needed — the existing
   `groups` claim mapper (Prompt 18) already includes every group a user
   is a member of, this one included.
4. Confirm at `GET /api/v1/auth/me` after that user logs in: the
   `scopes` field should show `{ role: "operator", envScopes: ["production"], teamScopes: [] }`.

## Provisioning via the existing OpenLDAP demo stack

The demo identity fixture (`compose/identity/ldap/bootstrap.ldif`) is the
authoritative example — read it directly rather than retyping it here.
The pattern for a new scoped user is two LDIF entries:

```ldif
dn: uid=my-scoped-user,ou=people,dc=arcanium,dc=local
objectClass: inetOrgPerson
uid: my-scoped-user
cn: My Scoped User
sn: User
givenName: My
mail: my-scoped-user@arcanium.local
userPassword: <a real password — POC fixtures use disclosed demo passwords only>

dn: cn=arcanium-operator:env:production,ou=groups,dc=arcanium,dc=local
objectClass: groupOfNames
cn: arcanium-operator:env:production
member: uid=my-scoped-user,ou=people,dc=arcanium,dc=local
```

The `cn` attribute (mapped via Keycloak's `group.name.ldap.attribute`,
already configured to `cn` in `setup_keycloak.sh`) carries the colon-
containing name straight through — verified live: `ldapadd` accepts
`cn=arcanium-operator:env:production,ou=groups,...` as a DN without any
special escaping, and the resulting Keycloak-federated `groups` claim
matches the LDAP `cn` value exactly.

Load it the same way the existing fixture is loaded — the loader is
per-entry and idempotent, so adding new entries to `bootstrap.ldif` and
re-running it never disturbs what's already there:

```sh
./scripts/compose.sh identity --profile init run --rm ldap-bootstrap
```

(Or `make identity-bootstrap`, which also re-runs the Keycloak realm
configuration step — safe to re-run any time.)

### The two demo accounts this prompt adds

`compose/identity/ldap/bootstrap.ldif` includes two ready-to-use scoped
demo accounts, used by `scenarios/16_multitenancy/test_scope_isolation.sh`
and deliberately holding **only** the scoped group — no bare
`arcanium-operator`/`arcanium-auditor` group — so they prove the scoped
path actually restricts, not merely that it's additive:

| User | Password | Group |
| --- | --- | --- |
| `demo-operator-prod` | `Arcanium-opprod-2026` | `arcanium-operator:env:production` |
| `demo-auditor-platform` | `Arcanium-auditplat-2026` | `arcanium-auditor:team:platform` |

## Combining an estate-wide role with a scoped one

```text
A user in both "arcanium-operator:env:staging" AND "arcanium-auditor" has:
  - estate-wide read (from the bare arcanium-auditor group — MATRIX.auditor.read = true,
    unconditional, exactly as today)
  - operator-class writes (provision/rotate/rewrap/destroy_request/reconcile)
    restricted to staging resources only (from the scoped grant)
```

This is exactly what `authorize()`'s two-step design produces without any
special-casing: step 1 (estate-wide roles) already grants unrestricted
`read` via the bare `auditor` group; step 2 (scoped grants) is only ever
consulted for actions step 1 didn't already allow, and there it applies
the `operator` role's own matrix row gated by `envScopes: ["staging"]`.

## Verifying a scoped assignment actually took effect

```sh
# After the user logs in through the normal OIDC flow:
curl -s -b "$COOKIE" http://localhost:3001/api/v1/auth/me | jq '.scopes'
```

Expect exactly the scoped grant(s) that user's groups declare — an empty
array (`[]`) means either the group assignment didn't propagate yet
(check Keycloak's federated group sync) or the group name doesn't match
the `arcanium-<role>:env:<value>` / `arcanium-<role>:team:<value>`
pattern exactly (case-sensitive, `SCOPABLE_ROLES` in `auth/authorize.js`
only recognizes `ciso`/`architect`/`operator`/`auditor`).

For a full, live, end-to-end proof beyond a single `/auth/me` check, run:

```sh
make scenario-scope-isolation
```

which drives real OIDC logins as both demo scoped accounts above and
asserts the actual enforcement behavior (403s, filtered lists, and the
one documented backward-compat case), not just that the identity model
parses correctly.
