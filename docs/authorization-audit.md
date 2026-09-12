# Authorization audit — Prompt 27, Deliverable 5

The standing discipline Prompt 18 introduced (the `GET /applications/:id`
tenant-scope gap, found live and closed) elevated to a formal, documented
artifact: for every route introduced in Prompts 20-26, does it correctly
apply `tenant`, and — since Deliverable 3 of this same prompt added the
environment dimension — `env`? A route that touches application,
desired_state, reconciliation, control_assessment, or service-account data
and misses either check is a defect fixed **in this prompt**, not a
follow-up item. Two real ones were found; both are fixed and covered by
`scenarios/16_multitenancy/test_scope_isolation.sh`, not merely documented.

## Method

Every `authorize()` call site in the audited files was read directly
(`grep -n "authorize(" arcanium/api/src/routes/*.js`), not assumed from
memory of what should be there. Every LIST route's SQL filtering was read
the same way. Findings below cite the actual route and the actual fix.

## Prompt 20 — `routes/reconciliation.js`

| Route | tenant | env (Deliverable 3) | team (Configuration C) | Notes |
| --- | --- | --- | --- | --- |
| `GET /` (list) | ✅ `tenantScope()` | ✅ **added this prompt** — filters by `a.environment` when the identity has a scoped grant, plus an optional `?env=` query filter | ✅ **added this prompt** — `teamReadScope()` | Three-way composition: tenant-scoped (supplier-admin) → unrestricted (estate-wide read) → env/team-scoped (new) → nothing (no grant at all covers read) |
| `POST /run` (single `desired_state_id`) | ✅ | ✅ **added this prompt** — `env: rows[0].environment` | n/a (single-resource, not list) | |
| `POST /run` (bulk, no `desired_state_id`) | ✅ (existing) | ✅ **added this prompt** — a bare `authorize({action:'read'})` gate; a scoped grant can never satisfy an unscoped bulk sweep (no env/team to check against), so it correctly denies a scoped-only identity that previously reached this path completely ungated | (same gate covers it) | **Real gap found**: before this prompt, a scoped-only identity (persona `"scoped"`, no MATRIX entry) reached this branch with no authorize() call at all |
| `PATCH /desired-state/:id` | ✅ | ✅ **added this prompt** — `env: appRows[0]?.environment` | n/a | |
| `GET /:run_id` | ✅ `tenantScope()` | ✅ **added this prompt** — `scopedReadDenied()` (see below) | ✅ **added this prompt** (same call) | **Real gap found**: a direct-by-id fetch was not scoped the same way `GET /` is — see "Cross-cutting finding" below |
| `POST /:run_id/reconcile` | ✅ via `runTenant()` | ✅ **added this prompt** — `runTenant()` now also selects `a.environment` | n/a | |
| `POST /:run_id/accept-exception` | ✅ via `runTenant()` | ✅ **added this prompt** | n/a | |

## Prompt 21 — `routes/controls.js`

| Route | tenant | team (Configuration C) | Notes |
| --- | --- | --- | --- |
| `GET /` (list) | ✅ `filterToScope()` (renamed from `filterToTenant()`) | ✅ **added this prompt** | **Real gap found — this is Configuration C's own named example**: *"GET /api/v1/controls returns all assessments for an operator session, regardless of team."* Before this prompt, `filterToTenant()` only ever consulted `tenantScope()` (supplier-admin); an estate-wide-role-less, team-scoped identity (e.g. `arcanium-auditor:team:platform`) got every assessment, unfiltered. Fixed: `filterToScope()` now also consults `teamReadScope()` when no estate-wide read role exists, narrowing to the team's suppliers' `vault_namespace` prefixes exactly as the tenant path already did for supplier-admin. |
| `GET /:id` | ✅ (assessments array only — the control *definition* is an estate-wide catalog entry, not tenant/team data, unchanged) | ✅ (same `filterToScope()`) | |

Controls have no `environment` column of their own (a control assessment's
`scope` string encodes tenant/application, not environment) — env-based
filtering was not added here; this matches Deliverable 3's own explicit
callsite list, which names `keys.js`/`applications.js`/`approvals.js`/
`reconciliation.js` and not `controls.js`.

## Prompt 25 — `routes/applications.js` (`GET /:id/intent`)

| Route | tenant | env | team | Notes |
| --- | --- | --- | --- | --- |
| `GET /:id/intent` | ✅ `tenantScope()` (unchanged since Prompt 25) | ✅ **added this prompt** | ✅ **added this prompt** | Same cross-cutting finding as `reconciliation.js`'s `GET /:run_id` below — fixed identically. |

## Cross-cutting finding: single-resource GET-by-id bypassed the LIST filter

The most significant finding from this audit, found by comparing every
LIST route's filtering against its sibling single-resource `GET /:id`
route rather than reading each file in isolation:

**`GET /applications/:id`, `GET /applications/:id/intent`, and
`GET /reconciliation/:run_id` all correctly checked `tenantScope()`
(supplier-admin) but had no equivalent check for a scoped (env/team)
grant.** A team-scoped identity with no matching estate-wide read role
— `demo-auditor-platform` (`arcanium-auditor:team:platform`), for
example — was correctly filtered out of `GET /applications`'s result
list, but could still fetch **any** application directly by UUID,
completely bypassing that same filter. This is exactly the shape of gap
Prompt 18 already closed once for the tenant dimension (`GET
/applications/:id` had no tenant check at all); this prompt's new scope
dimension reintroduced the identical class of bug in the same three
places.

**Fixed**: `auth/scope.js` gained `scopedReadDenied(identity, {supplierId,
env})` — the single-resource equivalent of `teamReadScope()`/the
`reconciliation.js` list's inline env logic, returning `true` (block,
respond exactly like a `tenantScope()` mismatch — `404`, the established
convention for a scoped-out resource in this codebase, not `403`) when
the identity has scoped grants but none of them cover this resource's
supplier/environment. Wired into all three routes above.

**Verified live**, not just read: `demo-operator-prod`
(`arcanium-operator:env:production` only) got `200` fetching a
production-tagged application by id and `404` fetching a staging-tagged
one — both by direct UUID, not via the list. Both assertions are now
permanent regression coverage in
`scenarios/16_multitenancy/test_scope_isolation.sh`.

## Noted, not fixed (out of this audit's scope) — `routes/jobs.js`

`GET /api/v1/jobs` (extended by Prompt 24 for `?status=stuck`) has no
tenant, environment, or team scoping at all — any authenticated session
sees every provisioning job on the platform. This is a pre-existing,
estate-wide-by-original-design property of `provisioning_jobs`
(introduced Prompt 14.2, well before this audit's Prompts 20-26 range):
the table has no `supplier_id`/`environment` column, only a generic
`target_type`/`target_id` pair that would need an extra per-row lookup
to resolve a tenant at all. Flagged here honestly as a related gap for a
future prompt to close deliberately (it would need a real design
decision about what "job" scoping even means across `supplier`/
`application`/`key` target types) — not silently expanded into this
prompt's own scope, and not left undocumented either.

## Summary

- 2 real, previously-undiscovered gaps found and fixed in this prompt:
  Configuration C's own named `GET /controls` team-scoping gap, and the
  single-resource GET-by-id bypass affecting three routes across two
  files.
- Every route this audit covers now applies tenant, environment (where
  Deliverable 3 gives it one), and team scoping consistently between its
  list and single-resource forms.
- One adjacent, pre-existing gap (`jobs.js`) is documented, not fixed —
  it predates this audit's stated scope and needs its own design
  decision, not an ad hoc patch here.
- All findings are backed by `scenarios/16_multitenancy/test_scope_isolation.sh`
  passing live (14/14), not by code review alone.
