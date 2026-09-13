# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Five remaining items from the six-stage lifecycle audit's own
  remainder (Prompt 39): LIKE-wildcard escaping, the maturity model's
  shallow custody scoring, `capture-state.sh`'s non-live
  `lifecycle_completion` component, live Vault Control Group
  verification, and the request→approval drift window.
  - **LIKE-wildcard escaping.** Every "does this vault_path end with
    this key_name" check across the codebase (`routes/keys.js`,
    `provisioner/key.js`, `approval-execution.js`, `offboarding.js`,
    `reconciliation/engine.js`, `routes/reconciliation.js`) used
    `LIKE '%/' || key_name` — but `_`/`%` in a key name are real LIKE
    metacharacters, not literal ones, letting an unintended key
    silently match through a tenant-resolution join. All converted to
    an exact suffix match (`right(vault_path, length(key_name)+1) =
    '/' || key_name`), which has no metacharacter surface at all.
    `aggregation/intent.js`'s scope query genuinely needs a trailing
    wildcard — kept as LIKE, but the namespace/app-name values are now
    escaped first (new `db.js#escapeLikeValue()`) with an explicit
    `ESCAPE '\'` clause, closing a real cross-tenant control-assessment
    leak an app named with `_`/`%` could otherwise trigger.
  - **Maturity model's shallow custody scoring.** `dimKeyLifecycle()`'s
    "versioned" signal was `min_decryption_version >= 1` — true of
    essentially any real Transit key from creation, rotated or not.
    Replaced with the same "genuinely rotated" (version > 1) signal
    `ladderChecks()` already used correctly, plus a new HSM-backed
    custody component. Also found and fixed a deeper gap while at it:
    the maturity model's own key inventory (`loadKeys()`) only ever
    read the primary Vault cluster — vault-hsm's Managed Keys were
    invisible to it, unlike `routes/keys.js`'s own `GET /keys`, which
    already merges both. Verified live: 9 keys now visible (up from
    the primary cluster alone), 1/9 correctly reported HSM-backed.
  - **`capture-state.sh`'s non-live `lifecycle_completion`.** Every
    count used `${var:-0}` against a psql call with discarded stderr —
    a genuinely FAILED query silently reported the same "0" a healthy
    empty table would. `count_or_unknown()` now tells the two apart
    (a real failure reports `null` and is named in a new
    `query_errors` array). Also added a real Vault cross-check this
    component never made before: `offboarding.completed` was a pure DB
    flag: a new `offboarding_live_check()` live-GETs every offboarded
    application's crypto_profiles paths and counts a genuine 404
    (destroyed) vs. a still-live 200 discrepancy — verified live
    against the one currently-offboarded application (2/2 confirmed
    destroyed).
  - **Live Control Group verification.** `POST /approvals/:id/approve`
    and `POST /approvals/:accessor/authorize` used to flip status to
    `'approved'` purely on the caller's say-so — nothing ever asked
    Vault whether the accessor had actually been authorized by a real
    crypto-approvers member, even though the provisioner token already
    had unused `read` access to `sys/control-group/request` (a real,
    side-effect-free status check, verified live against a genuine
    `transit/encrypt/external-supplier-key` Control Group request).
    Both routes now fail closed (409) unless Vault itself reports
    `approved: true`, and record Vault's own named authorizing entity
    as the approver instead of a hardcoded `"arcanium-api"` string.
    Verified live end-to-end: approving before the real Vault authorize
    step correctly refuses (409); after it, approves and records
    `approver: "arcanium-approver-1"`.
  - **Request→approval drift window.** Prompt 36 pinned a destroy
    request's key version at request time and re-verified it before
    execution, but nothing re-confirmed the pin at the moment of
    approval itself. `POST /:id/approve` now live-reads the key's
    current Vault version and refuses (409, naming both versions) if
    it has moved past the pin since the request was raised — verified
    live end-to-end against a disposable test key rotated between
    request and approval (pin=1, live=2 → correctly refused).
  - Full regression green (fitness 37/0/1, negative-auth 30/0,
    verify-stack 53/1/0). All disposable test fixtures created for live
    verification (a throwaway application/key, a synthetic Control
    Group request) were cleaned up afterward.
- Rotation correctness, destroyed-key reporting, and the key detail
  page's dead Version history card (Prompt 38). Reconciliation's
  rotation_period requirement only ever checked the CONFIGURED
  `auto_rotate_period`, never whether the key had actually rotated
  recently — Vault's own auto-rotation is real and server-side, but
  nothing here would have noticed if it silently stopped, or if the
  configured value weren't actually in effect. A new
  `compareRotationPeriod()` also checks the current version's real age
  against the desired period (with a 1-day grace window), correctly
  reporting `DRIFTED` with an honest "N days old — overdue for
  rotation" detail rather than a false `COMPLIANT`. A destroyed key's
  rotation requirement previously reported `UNKNOWN` forever
  (indistinguishable from "Vault unreachable"); now reports
  `COMPLIANT` (nothing left to violate), mirroring how expiry_date
  already treats a destroyed key. The dashboard's "Rotate —
  Demonstrated" badge no longer counts a merely-configured policy on
  its own — only real evidence-trail rotation events. Found live while
  verifying: Vault's per-version metadata for a symmetric key
  (`aes256-gcm96`) is a bare creation-time epoch number, never an
  object — the exact quirk `publicKeyOf()` already had to handle,
  now also handled in `observeRotationPeriod()` and the key detail
  page's Version history card, which was previously always empty for
  every key (it read a field, `versions`, that the detail route never
  actually populates — the real per-version data is under Vault's own
  `keys` field) — now renders real version rows with correctly
  formatted creation dates, verified live for both real Vault entry
  shapes. Full regression green.
- Generate, Store, and Use lifecycle correctness (Prompt 37) — the
  remaining stages from the full six-stage lifecycle audit, after
  Prompt 36 closed Destroy's critical/high findings. Generate:
  provisioning's "record crypto profile"/"record desired state" steps
  had no rollback at all — a later step's failure rolled back the Vault
  key but left the DB rows asserting it still existed; both now
  correctly restore prior values (a re-provision) or delete cleanly (a
  fresh insert), verified live with a real forced-failure rollback.
  The Vault-key rollback step itself force-set `deletion_allowed=true`
  unconditionally with no restoration on a failed delete — the same
  bug class Prompt 36 fixed in the destroy path, present here too, now
  fixed identically. `POST /api/v1/keys` wrote with the wrong token and
  was returning a genuine live `500` for any key name outside one
  hardcoded exception — fixed and verified (now `201`, with a real
  audit-trail record). Store: `resolveKeyMeta()` hardcoded
  `hsm_backed: true` for anything read off the vault-hsm cluster,
  contradicting `custody` (same response) for a plain software key that
  merely lives there — now derived consistently with the list route.
  `managed_key_name` was an uncorrelated first-in-list pick; corrected
  (after verifying live that Vault's own key metadata has no such field
  to read directly, contrary to an initial assumption) to report a name
  only when genuinely unambiguous. Degraded key reads now report
  `null`/`false` explicitly instead of leaving fields `undefined`,
  which a truthiness check could render as a false "protected" claim.
  The dashboard's Store/Distribute tiles no longer use a hardcoded
  string or a registered-vs-provisioned mismatch; Store's tile no
  longer links to a permanently-empty evidence filter. Use:
  `usageOf()` is now namespace-scoped (was leaking cross-tenant
  operation counts into a same-named key's usage figure); evidence
  ingestion now counts and logs dropped rows instead of silently
  discarding them; `GET /health` exposes whether evidence ingestion is
  enabled at all, so the key detail page can tell "disabled" apart from
  "genuinely unused"; the dashboard's Use tally no longer falls back to
  an unrelated, inflated total. Full regression green.
- Destroy-path safety and correctness (Prompt 36) — triggered by a full
  six-stage lifecycle audit ("the lifecycle has to be bulletproof"),
  found four critical, currently-armed gaps in the destroy-approval
  pipeline: (1) the key to actually delete was resolved via an
  unordered, un-tenant-scoped `LIKE ... LIMIT 1` — two tenants with a
  same-named key made the real delete target a coin flip; (2)
  `deletion_allowed` was force-set before every delete with no read of
  the key's actual live protection state, and never restored if the
  delete then failed, permanently stripping a key's own
  delete-protection as a side effect of a failed attempt; (3) a real
  TOCTOU window existed between the governance-intent check and the
  actual delete — an Accept-Exception click in that window did not stop
  an in-flight destroy, the exact incident this code's own header
  comment says it was built to prevent, only narrowed to a window, not
  closed; (4) nothing pinned what a destroy approval was actually raised
  against, so it executed against whatever a bare key name currently
  resolved to, including a since-rotated or since-recreated key. Also
  fixed: the placeholder "first registered application" every destroy
  request was attached to (closing three separate downstream
  workarounds this had forced), a matching cross-tenant gap in the
  offboarding auto-approval trigger, a reconciliation join that could
  submit a destroy request against the wrong key on a multi-key
  application, a missing concurrency guard on the destroy-execution
  claim, a fabricated "Destroy — Demonstrated" dashboard badge that
  fired on a merely-pending, never-executed request, a genuinely
  non-atomic `upsertDesiredState()`/migration-runner transaction (each
  `BEGIN`/`COMMIT` statement could land on a different pooled
  connection), and the complete absence of any way to create the
  destroy gate's primary trigger (`expiry_date` desired-state) at all.
  Verified live against real, disposable Vault keys/applications
  (including a deliberately-planted cross-tenant name collision, a live
  key rotation to force a pinned-version mismatch, and two racing
  Postgres transactions proving the new concurrency claim), all cleaned
  up afterward with zero trace remaining. Full regression green.
- SSR hydration mismatch on first unauthenticated page load (Prompt 35,
  `UI_AUDIT.md` Finding 4): a brief flash of Dashboard chrome (never real
  protected data) before self-correcting to the login form, on a cold
  first request only. Root-caused via temporary debug logging (not the
  original "race" theory): `useRequestFetch()`'s internal dispatch of
  `/gateway/api/v1/auth/me` re-entered Nuxt's own SSR route-middleware
  pipeline for that URL on a cold request, and the nested run's own
  redirect materialized as an HTML stub body that fooled the outer call
  into treating it as a non-error response — letting the real page fall
  through and render before the client branch caught the 401 a moment
  later. Fixed with one line: exempt `/gateway/` (never a navigable
  page) from the auth middleware, the same way `/login` already is.
  Verified across two independent cold container restarts (first real
  request now a clean 302, never the previous 200) and a live Playwright
  session immediately post-restart (no hydration-mismatch warning).
  Given this file's own documented past incident (a sustained SSR 401
  loop causing CPU pegging and OOM crashes), watched container CPU/
  memory/logs for 90s post-fix under real healthcheck load — stable, no
  repeat. Full regression green.
- App-wide `--arc-text-dim` contrast violation (Prompt 34,
  `FRONTEND_QUALITY_GATE.md` Finding B): 45 real instances across 17
  files (a superset of the originally reported 28/20+ — re-auditing
  before fixing found cases the original same-line grep missed, where
  the small font-size came from a parent/base selector rather than the
  same line as the color) of small body-adjacent text
  (footnotes, breadcrumb separators, timestamps, request IDs, badges,
  hints) using the large/bold-only `--arc-text-dim` token (~4.3:1).
  Promoted to `--arc-text-muted` (6.4:1, AA body floor), except five
  breadcrumb separators promoted to `--arc-text-secondary` (11:1) to
  match the adjacent "current page" segment already using it. No layout
  change (color value only); full regression green; live computed-style
  spot-check and a Playwright screenshot sweep confirmed no regression.

### Added

- Supplier-scoped key rotation (Prompt 40) — the last open item from the
  six-stage lifecycle audit. `POST /api/v1/keys/:name/rotate` was, and
  remains, structurally root-namespace-only (`ownerOfKey()`'s join
  deliberately excludes supplier-tenant applications — Prompt 36, closing
  a real cross-tenant leak), which meant a supplier-admin could never
  rotate their own tenant's key through any route at all — a missing
  capability, not a live bug (nothing was silently wrong; a supplier's
  attempt was correctly denied rather than mis-routed). New `POST
  /api/v1/suppliers/:id/keys/:name/rotate` closes it: same tenant-scope
  check (404, not 403, for a wrong-tenant caller) every other
  supplier-scoped route in this file already uses, same `authorize()`
  'limited' verdict the MATRIX already expressed for supplier-admin
  rotate — nothing in the authorization model itself needed to change.
  `provisioner/key.js`'s `rotateKey()` gained an optional `namespace`
  parameter (root-namespace call sites unchanged). Required one new,
  narrowly-scoped Vault policy grant (`suppliers/+/transit/keys/+/rotate`,
  `update` only — the existing wildcard family was read-only) — verified
  live via a fresh AppRole session token (not root) before any
  application code was written, then end-to-end through the real API:
  a supplier-admin rotating their own tenant's key (200), the same key
  cross-tenant (404, no existence confirmed), an estate-wide role
  (architect, 200 — unrestricted exactly as on the root-namespace route),
  and a denied role (auditor, 403). New negative-auth check added
  (pepsi-admin rotating cocacola's key → 404).
- Real evidence behind the key detail page's lifecycle strip (Prompt
  33): `Distribute` and `Use` previously hardcoded `on: true`/`on: false`
  for every key, unconditionally — a fabricated claim in one direction,
  a stale one in the other. `Distribute` is now derived from a real
  `crypto_profiles` join (null, not false, for a platform key like
  `document-signing-key` that isn't modeled through the
  applications/crypto_profiles table at all); `Use` from the `evidence`
  table's already-ingested Vault audit log rows (11k+ real operations,
  previously never queried by this page). Found by the user while
  reviewing a screenshot; fixed same-day, ahead of the previously
  planned sequencing.
- Supplier-scoped public key material download (Prompt 32): the same
  public-key download offered for root-namespace keys now also works for
  a supplier tenant's own Transit keys (`pepsi-signing-key`,
  `cocacola-signing-key`) via `GET /api/v1/suppliers/:id/keys/:name/public-key`.
  Required a new, read-only Vault policy grant
  (`suppliers/+/transit/keys*`, wildcarded across every tenant namespace
  rather than hardcoded per-tenant) — verified live, before and after,
  against `arcanium-api`'s own real AppRole token, not root. Also fixed a
  dormant bug this made newly reachable: `GET /api/v1/suppliers/:id/keys`
  previously returned bare key-name strings while the supplier page's
  template already expected full `{name, type, has_public_key}` objects
  (masked until now by a 403 that always collapsed the route to `[]`).
  Found and fixed along the way, via Playwright driving the real browser
  UI rather than curl-only checks: `ui/server/routes/gateway/[...path].ts`
  forwarded no upstream response header but `Set-Cookie`, silently
  dropping `Content-Disposition` (the suggested filename) for every
  "download public key"/"download CA chain" link that goes through it —
  including Prompt 31's own root-key download and the PKI CA chain
  download, both already shipped. Fixed by forwarding `content-type` and
  `content-disposition` explicitly.
- Public key/CA material download (Prompt 31): the public half of an
  asymmetric key (`GET /api/v1/keys/:name/public-key`) and the PKI
  intermediate CA chain, as real file downloads — never a private or
  symmetric key's bytes, enforced by checking for an actual public-key
  PEM in Vault's own response rather than a key-type allowlist. New PKI
  page in the UI (previously API-only, no UI surface at all). Found and
  fixed along the way: a real, pre-existing custody-accuracy bug where
  `GET /api/v1/keys/:name` and the unified intent view (Prompt 25) each
  independently resolved `document-signing-key` against the wrong
  cluster (primary instead of vault-hsm), showing the wrong custody
  label and, via the new download route, would have returned the wrong
  public key entirely. Fixed with one shared resolution helper.
- Real OIDC authentication (Keycloak, OpenLDAP-federated) replacing the
  earlier Vault-userpass-backed session model; roles and tenant scope
  derive from OIDC groups, not a hardcoded username map. Deny-by-default
  authorization centralized in one `authorize()` gate. See
  [security.md](docs/security.md) and [personas.md](docs/personas.md).
- Desired-state reconciliation: a declared rotation policy (and, later,
  a declared key-expiry date) observed against Vault's live state, with
  an independent `observation_status`/`disposition` model, a governed
  reconcile action, and a time-boxed governed exception path. See
  [api.md](docs/api.md).
- A gated, evidence-based maturity model (`GET /api/v1/maturity`)
  replacing an earlier averaged score — a single mandatory control at
  `FAIL` or `UNKNOWN` caps the level regardless of every other
  dimension. See [maturity-model.md](docs/maturity-model.md).
- Architecture fitness tests, an OpenAPI contract
  (`openapi/arcanium.yaml`) as the authoritative machine-checked route
  contract, and generated TypeScript types kept in sync with it.
- Control-plane multitenancy: environment/team scoped grants alongside
  the existing role and tenant-scope axes, a teams registry, and a live
  isolation proof using real, narrowly-scoped OIDC sessions. See
  [multitenancy.md](docs/multitenancy.md).
- External integration surface: a service-account (Bearer token)
  machine identity, webhooks for reconciliation/expiry events
  (HMAC-signed, every delivery attempt recorded), and a minimal,
  unpublished Terraform provider skeleton proven against a real
  `terraform apply`/`destroy`. See
  [external-integration.md](docs/external-integration.md).
- Key-lifecycle completion: an `expiry_date` desired-state requirement
  whose reconcile action submits a governed destroy request rather than
  mutating Vault directly, and a governed application-offboarding
  workflow (never a cascade delete). See
  [external-integration.md](docs/external-integration.md).
- Operability drills: a real Vault Raft snapshot/restore drill and a
  real PostgreSQL loss/recovery drill, both against live containers and
  volumes, not simulated.
- Frontend design-toolchain and quality-gate passes: an explicit,
  evidence-derived `DESIGN.md`, a Playwright-driven baseline/regression
  process, and a documented release verdict. See
  [docs/frontend/](docs/frontend/).
- Resilience hardening (Prompt 29), closing gaps found during a live
  incident: bounded-backoff retry for both Vault credential-rotation
  loops (a single failed rotation previously stopped the loop
  permanently); container healthchecks retargeted from a
  process-liveness-only probe to a real database-connectivity probe;
  `KML-DESTR-01` wired into gated-maturity-level enforcement so a
  failing mandatory control actually caps the level; and a worker step
  that executes governed key-destruction approvals against Vault
  (previously approval only ever recorded a status, never executed) —
  gated on live governance intent (a still-active drift or an
  in-progress offboarding) after an initial unconditional version
  destroyed two real, still-in-use keys during this same hardening
  pass. Shared OIDC-login helper (`scenarios/lib/oidc_login.sh`)
  replacing three independently-patched inline copies.
- Vault Agent adoption (Prompt 30): a real HashiCorp Vault Agent sidecar
  (`arcanium-vault-agent`) now owns AppRole auto-auth and dynamic
  database-credential rendering for the `arcanium-api` identity,
  replacing the hand-rolled login/retry loops Prompt 29 had to patch.
  `arcanium-api`/`arcanium-worker` read a token and a live credential
  from Agent's rendered files (shared, read-only volume) instead of
  authenticating themselves; every direct Vault call they still make on
  their own behalf (Transit, PKI, Control Group) is unchanged. Proven
  live: a real `vault-1` outage during Agent's own re-auth attempt
  recovered fully automatically (Agent's own exponential backoff,
  visible in its logs), the running `arcanium-api` process picked up
  the new token and rotated its database pool via a file watcher, with
  zero application-level retry code involved and the container never
  restarted.

- Three-node Vault Raft cluster with a Transit seal provider (`vault-s`) and a
  separate `+ent.hsm` instance (`vault-hsm`) backed by SoftHSM over a PKCS#11
  proxy. Bootstrap, status and Raft snapshot scripts.
- Express API: supplier / application / key registry, Vault AppRole auth with
  dynamic PostgreSQL credentials, numbered migrations, provisioning jobs with
  best-effort rollback, and an optional queue worker.
- Runtime orchestration — `POST /suppliers` and `/applications/:id/provision`
  create real Vault namespaces, identities, policies, Transit keys, PKI roles
  and quotas.
- Governance — approval records with source attribution, a ciphertext-only
  rewrap endpoint, and a governed key-destroy request path.
- Managed Keys (PKCS#11 custody on `vault-hsm`) and the Key Management engine
  with an emulated KMS (`compose/kms-sim`, LocalStack) for the distribution
  lifecycle.
- Sentinel EGPs — `deny-unapproved-key-destroy`, `protect-audit-devices`,
  `rotation-from-automation`.
- Evidence trail — approval-derived, orchestration and (optional) audit-log
  rows, each mapped to a Key Management Lifecycle stage.
- Server-side maturity assessment (`GET /api/v1/maturity`) across five
  dimensions with an implementation-heuristic level.
- Nuxt 4 management UI with a same-origin gateway: command-centre dashboard,
  guided onboarding wizard with a live provisioning preview, tenant-isolation
  view backed by a live bidirectional check, cluster topology strip, integration
  channel cards, and a KML-tagged evidence trail.
- Arcanium CLI for health, suppliers, applications (incl. `classify`), keys,
  approvals, jobs, onboarding and integrations.
- Optional observability stack (Prometheus, Grafana, OTel collector) and
  optional Vault userpass sessions with demo personas.
- Documentation set under `docs/` with a guide index.

### Changed

- Podman is the canonical local and CI image runtime.
- The frontend moved from `ui/` to `arcanium/ui/`, alongside `arcanium/api` and
  `arcanium/cli`.
- `architecture.md` and `usage.md` moved into `docs/`.

### Security

- TLS verification stays enabled for application-to-Vault traffic.
- Local bootstrap uses simplified recovery settings and software-backed SoftHSM
  tokens; these are lab shortcuts, not production custody.
