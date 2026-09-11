# API reference

The Express API listens on port 3001 by default. Browser calls normally use the UI's same-origin gateway. The API is authoritative for business operations; the gateway must preserve required session context and expose only intended routes.

This reference describes implemented source routes. Optional routes can return unavailable/permission errors when dependencies, migrations, credentials or licenses are absent. Inspect the response and deployed version instead of assuming every route is active.

**[`openapi/arcanium.yaml`](../openapi/arcanium.yaml) is the authoritative machine-checked contract** (Prompt 22) — request/response schemas, auth requirements and the error envelope shape for every route below, generated TypeScript types (`arcanium/ui/app/types/api.generated.ts`, `make openapi-generate`), and `scenarios/13_fitness/`'s coverage checks are all derived from or validated against it. This page stays as hand-authored narrative alongside it — if the two ever disagree, the OpenAPI file is correct; treat the disagreement as a doc bug here, not a contract bug there.

## Health and platform

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | Vault authentication and database readiness; 503 when unavailable |
| GET | `/health` | Dependency summary and API version |
| GET | `/metrics` | Prometheus metrics, outside session middleware |
| GET | `/api/v1/cluster` | Array of Vault nodes with reachability and health metadata |
| GET | `/api/v1/platform/entitlements` | Feature flags derived from Vault license inspection |
| GET | `/api/v1/observability/health` | Optional observability dependency health |
| GET | `/api/v1/observability/summary` | Operational summaries through backend adapters |
| GET | `/api/v1/maturity` | Gated assessment — `{maturity, coverage, confidence}` plus supplementary `dimensions`/`checks`; see [maturity model](maturity-model.md) (Phase 21 — replaced the old averaged single percentage) |

## Suppliers

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/v1/suppliers` | Supplier registry; tenant scoping applies where enabled |
| POST | `/api/v1/suppliers` | Register and provision a tenant; returns supplier and job |
| GET | `/api/v1/suppliers/isolation` | Live bidirectional namespace check across registered tenants (60s cache) |
| GET | `/api/v1/suppliers/:id` | Supplier detail |
| PATCH | `/api/v1/suppliers/:id` | Update supported registry metadata |
| DELETE | `/api/v1/suppliers/:id` | Guarded deprovisioning and record removal |
| GET | `/api/v1/suppliers/:id/applications` | Supplier application records |
| GET | `/api/v1/suppliers/:id/keys` | Namespace Transit inventory |

Supplier body:

```json
{
  "name": "acme",
  "vault_namespace": "suppliers/acme",
  "sla_tier": "standard"
}
```

Names are limited to 128 letters/numbers/underscore/hyphen characters. Namespace paths use the same characters in slash-separated segments and are limited to 256 characters. SLA tier is `standard` or `premium`.

`POST ?dry=true` skips namespace provisioning but still creates a registry row; it is not a read-only preview. Normal creation can return a queued job or a provisioning failure. PATCH updates metadata and is not a namespace migration. DELETE refuses linked applications/history and can refuse namespaces containing keys. `force=true`, where supported, changes destructive behavior and is not a routine UI cleanup option.

## Applications

| Method | Path | Behavior |
| --- | --- | --- |
| GET / POST | `/api/v1/applications` | List / register |
| GET / PATCH / DELETE | `/api/v1/applications/:id` | Inspect / update supported fields / remove registry entry |
| POST | `/api/v1/applications/:id/provision` | Provision configured crypto profile/workload resources |
| POST | `/api/v1/applications/:id/classify` | Classify platform versus tenant application scope |

Registration accepts `name`, optional `description` and optional `supplier_id`. Provisioning accepts the fields validated in its route, including custody, key type, capabilities and rotation settings. Application registration and resource provisioning are separate steps.

## Keys and certificates

| Method | Path | Behavior |
| --- | --- | --- |
| GET / POST | `/api/v1/keys` | Inventory / create supported Transit key |
| GET | `/api/v1/keys/:name` | Key metadata, subject to namespace/custody support |
| POST | `/api/v1/keys/:name/rotate` | Rotation job |
| POST | `/api/v1/keys/:name/rewrap` | Ciphertext rewrap; persona restrictions apply |
| POST | `/api/v1/keys/:name/destroy` | Destruction request/approval path, not unconditional deletion |
| GET | `/api/v1/pki/ca-chain` | CA chain |
| GET | `/api/v1/pki/roles` | PKI roles |
| GET | `/api/v1/keymgmt` | Key distribution inventory/status |
| POST | `/api/v1/keymgmt/:name/rotate` | Distribution-key rotation |
| POST | `/api/v1/keymgmt/:name/sync` | Synchronize distribution state |

Do not infer key custody from a key's name. Do not expose private key material. Inventory capability flags and metadata may vary between software Transit keys, Managed Keys and other backends.

## Governance, evidence and jobs

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/v1/approvals` | Pending by default; `?all=true` includes resolved records |
| POST | `/api/v1/approvals` | Register request with app, key, action, requester and optional source/accessor/supplier |
| POST | `/api/v1/approvals/:id/approve` | Record approval decision |
| POST | `/api/v1/approvals/:id/deny` | Record rejection, optional reason |
| POST | `/api/v1/approvals/:accessor/authorize` | Accessor-based decision-recording alias |
| GET | `/api/v1/evidence` | Merged evidence rows; see limits below |
| GET | `/api/v1/jobs` | Job list, optional status filter |
| GET | `/api/v1/jobs/:id` | Job and step detail |
| GET / POST | `/api/v1/integrations` | Integration registry/status / registration |
| POST | `/api/v1/integrations/:name/heartbeat` | Record integration liveness |

Approval status is `pending`, `approved` or `rejected`; the UI labels rejected decisions as denied. Source is `manual`, `local` or `external`. `approve` and `authorize` naming does not imply a Vault authorization call: inspect the route and use the explicit Vault operator flow when needed.

Evidence supports `source`, `operation`, `outcome`, `origin` and `stage` query
filters. The route scans a bounded window (wider than the display limit so older
rotate/destroy rows are not crowded out), classifies each row, then applies the
filters. It returns an object — `{ rows, stage_counts, total }` — not a bare
array: `stage_counts` tallies the six Key Management Lifecycle stages over the
scan window, `total` is the post-filter count, `rows` is capped at the display
limit. Rows carry `origin` (`approval`, `audit-log` or `orchestration`) and a
derived `lifecycle_stage`. Pending governance rows must not be narrated as
successful cryptographic operations, even when the coarse `outcome` field says
`ok`. Lifecycle-stage inference is a summary, not independent proof of execution.

## Desired state + reconciliation (Phase 20)

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/v1/reconciliation` | Desired-state rows joined to their latest run; tenant-scoped from its first commit |
| POST | `/api/v1/reconciliation/run` | On-demand observe→compare→persist sweep — never mutates Vault |
| PATCH | `/api/v1/reconciliation/desired-state/:id` | Edit the desired value itself (e.g. change desired rotation from 30 to 90 days) |
| GET | `/api/v1/reconciliation/:run_id` | One run in full — desired-state history + reconcile/accept-exception action history |
| POST | `/api/v1/reconciliation/:run_id/reconcile` | Correct drift — writes the desired value back to Vault, re-observes; only on a `DRIFTED` run |
| POST | `/api/v1/reconciliation/:run_id/accept-exception` | Governed, time-boxed exception — does **not** touch Vault; `reason` and `expires_at` both required |

Every reconciliation row carries `observation_status` (`COMPLIANT`/`DRIFTED`/`UNKNOWN`) and `disposition` (`OPEN`/`EXCEPTION_ACCEPTED`/`RECONCILED`) as two **independent** fields — never merged into one combined value. An accepted exception does not change what was actually observed in Vault; it only changes how Arcanium treats that observation. A `DRIFTED` run with `disposition: EXCEPTION_ACCEPTED` is still drifted.

## Controls / Evidence v2 (Phase 21)

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/v1/controls` | Latest assessment per `(control_id, scope)`; tenant-scoped from its first commit |
| GET | `/api/v1/controls/:id` | One control's catalogue definition plus its per-scope assessments |

Every assessment carries `status` (`PASS`/`FAIL`/`UNKNOWN`/`N/A`), `confidence` (`HIGH`/`MEDIUM`/`LOW`), and `evidence_refs` pointing at what was actually read — a live Vault call, a reconciliation run id, a Sentinel EGP list, a recorded hostile-scenario result. `GET /api/v1/maturity` is the aggregate/gated view over this same evidence; these two routes are the per-control detail behind it.

## Authentication (Phase 18 — OIDC)

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/v1/auth/login` | Begins the Authorization Code + PKCE flow; `302` redirect to Keycloak, never a JSON response |
| GET | `/api/v1/auth/callback` | Exchanges the code, creates the session, sets `arc_session`; `302` redirect back to the app |
| GET | `/api/v1/auth/me` | Current identity (user, persona, namespaces, groups) or disabled-mode information |
| POST | `/api/v1/auth/logout` | Destroys the session |
| POST | `/api/v1/auth/demo-persona` | Presentation-only persona switch — never a real privilege change; scoped grants (if any) are set only by actual OIDC group membership |

There is no `POST /api/v1/auth/login` — the userpass path was removed with Phase 18. Express is the OIDC client end-to-end; the browser only ever holds the opaque `arc_session` cookie, never a token. `/login` and `/callback` are the two routes that must issue a real browser redirect rather than be proxied as JSON — the UI gateway fronts them with dedicated relay routes (`ui/server/routes/gateway/api/v1/auth/{login,callback}.get.ts`), not the generic `[...path].ts` proxy every other route goes through.

Authentication is off unless `ARCANIUM_AUTH_ENABLED` is set — every session then defaults to an estate-wide operator identity, and every mutating route's `authorize()` check trivially passes. The cookie carries an idle timeout; see [security](security.md) and [personas](personas.md) for the full authorization matrix.

## Errors and compatibility

- `400`: validation failure.
- `401` / `403`: authentication or permission failure.
- `404`: absent resource/route, sometimes intentionally hiding another tenant.
- `409`: conflict, resolved approval or guarded lifecycle refusal.
- `5xx`: backend/dependency or provisioning failure.

Frontend errors should be safe summaries. Never render raw Vault error bodies, credentials or arbitrary backend payloads. For exact accepted fields and response shape, inspect [route source](../arcanium/api/src/routes) and [authentication source](../arcanium/api/src/auth/index.js).
