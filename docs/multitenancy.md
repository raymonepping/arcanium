# Control-plane multitenancy (Prompt 27)

Two independent scoping axes existed before this prompt: `role` (what a
persona can do) and `tenantScope` (which supplier namespace a
supplier-admin is confined to). Prompt 27 added two more, orthogonal to
both: **environment** and **team** — a grant can be narrowed to
`env:production` or `team:platform` without being a supplier-admin at
all, and without touching the existing estate-wide roles.

## Scoped grants derive from OIDC groups, same mechanism as roles

`arcanium/api/src/auth/authorize.js: groupsToIdentity()` parses two extra
group-name shapes, on top of the plain `arcanium-<role>` groups
[personas.md](personas.md) already documents:

```text
arcanium-<role>:env:<environment>
arcanium-<role>:team:<team>
```

Only four roles are scopable this way — `ciso`, `architect`, `operator`,
`auditor` (`SCOPABLE_ROLES` in `authorize.js`). `supplier-admin` is
excluded by design: it already has its own, older tenant-scope axis, and
mixing both onto one persona would make an identity's actual reach
ambiguous.

An identity can hold multiple scoped groups (e.g. `arcanium-operator:env:
production` *and* `arcanium-auditor:team:platform`) — these merge per
role into `identity.scopes[]`, not into one combined grant.

## The "scoped" sentinel persona

A session whose OIDC groups grant **only** scoped roles — no bare
`arcanium-<role>` group at all — gets `persona: "scoped"`, a literal
sentinel string the role matrix (`MATRIX` in `authorize.js`) has no entry
for. This was a real design bug caught during implementation, not a
defensive measure added out of caution: an earlier version let
`primaryRole` fall back to a scoped role's own name (e.g. "operator"),
which would have silently promoted a `production`-only operator into an
unrestricted, estate-wide one the moment any request rebuilt the
session — completely defeating the scoping. `"scoped"` has no matrix
entry, so step 1 of `authorize()` always correctly falls through to the
scoped-grant check (step 2) for that identity, never the estate-wide one.

## How `authorize()` resolves a scoped grant

`authorize()` now takes optional `env`/`team` parameters in addition to
`tenant`. Resolution is two steps, in order:

1. **Estate-wide roles first.** If the caller holds a bare `arcanium-
   <role>` group, the existing [personas.md](personas.md) matrix applies
   exactly as before — scoping never narrows an estate-wide grant.
2. **Scoped grants, only if step 1 didn't already allow.** For each
   scoped grant the identity holds, an empty `envScopes`/`teamScopes`
   means "all" for that one dimension; a non-empty list must contain the
   request's `env`/`team` argument. A `'limited'` verdict (the
   supplier-admin shape) also checks `identity.tenantScopes`.

A route that never passes `env`/`team` into `authorize()` cannot be
narrowed by a scoped grant at all — it silently behaves as if every
scoped identity were estate-wide for that one route. This was a real,
found gap (Deliverable 3's audit, below), not a hypothetical.

## The cross-cutting authorization audit

Every mutating route and every tenant-relevant `GET` was re-checked
against this new axis — `docs/authorization-audit.md` is the full,
route-by-route record, including the exact gaps found and closed. Two
worth naming here:

- `GET /applications/:id`, `GET /applications/:id/intent`, and
  `GET /reconciliation/:run_id` respected the older `tenantScope()` check
  but had no scoped-grant equivalent — a team-scoped identity could
  bypass a list-level filter entirely by fetching a resource directly by
  UUID. Closed by `arcanium/api/src/auth/scope.js: scopedReadDenied()`.
- `keys.js`'s rotate/rewrap/destroy routes passed no tenant argument to
  `authorize()` at all, before this prompt — a pre-existing gap, not
  introduced by scoping, found as a byproduct of wiring env/team through
  the same call sites.

## Teams

`teams` (`arcanium/api/src/teams/registry.js`, migration `017_teams.sql`)
is a new, estate-wide-only registry: `supplier_ids UUID[]` (`NULL` means
"all suppliers") and `environments TEXT[]`, resolved both directions —
`resolveTeamForSupplier()` and `resolveSupplierIdsForTeam()`. A
team-scoped grant's read filter (`teamReadScope()`) resolves through this
table, the same way a supplier-admin's tenant scope resolves through
`suppliers.vault_namespace`.

## Environment tagging

`applications.environment` (migration `018_environment_tag.sql`,
`TEXT NOT NULL DEFAULT 'production'`) is the other half of the axis —
every application now carries an explicit environment, defaulted, never
left null. Provisioning, reconciliation, and every list/detail route that
already carried a tenant check gained the equivalent environment check at
the same call site.

## Proving it — real sessions, not simulated ones

`scenarios/16_multitenancy/test_scope_isolation.sh` (`make
scenario-scope-isolation`) drives real OIDC logins as two demo accounts
whose LDAP group membership holds **only** a scoped grant, never a bare
role:

| Account | Group | Password |
| --- | --- | --- |
| `demo-operator-prod` | `arcanium-operator:env:production` only | `Arcanium-opprod-2026` |
| `demo-auditor-platform` | `arcanium-auditor:team:platform` only | `Arcanium-auditplat-2026` |

14 assertions across four configurations: a scoped session denied
outside its scope, the same session allowed inside it, an estate-wide
role unaffected by scoping, and a scoped grant against an
estate-wide-only resource (`teams`) correctly denied — proving a scoped
grant never silently becomes an estate-wide one just because a route
forgot to pass `env`/`team`. The fourth case substitutes `GET`/`POST
/api/v1/teams` for scoped illustrative examples that don't exist in this
codebase; it demonstrates the identical point using a real route.

Re-runnable: the fixture toggles its own desired-state value between two
values on every run so the reconcile assertion always gets a genuine
`DRIFTED` status to reconcile, rather than depending on whatever state a
previous run left behind.

See [security.md](security.md) for the full authorization matrix this
axis sits alongside, and [identity-configuration.md](identity-configuration.md)
for how these LDAP/Keycloak groups are provisioned.
