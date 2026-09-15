# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Sidebar navigation (Prompt 46) regrouped by function, then by type,
  with a divider between groups: Dashboard · Suppliers/Teams/
  Applications/Onboard · Integrations/Jobs · Keys/PKI · Cluster/
  Observability/Maturity · Reconciliation/Approvals/Evidence. User:
  "Grouping by function, and then by type" — asked where Reconciliation
  should sit (platform-state group or governance group); the user
  agreed it reads better next to Approvals/Evidence, since reconciliation
  runs are what approval/destroy gates key off of. No grouping/divider
  mechanism existed before (`arcanium/ui/app/layouts/default.vue`'s
  `navItems` was a flat array) — added from scratch, including a second
  filter pass that drops any divider left leading, trailing, or adjacent
  to another divider once the `supplier-admin` persona's platform-item
  filter runs (verified live in both personas). The ⌘K command palette's
  item list was reordered to match for consistency, since its default
  empty-query view shows the first six.
- Sidebar/⌘K order (Prompt 48): Onboard now comes before Applications.
  User, discovering mid-walkthrough that Applications is a read-only
  list with no inline "+ Create" (registration only happens through the
  Onboard wizard): "we need to move onboard 1 level up. above
  'applications'. that keeps it in logical order." Same group, same
  divider placement — just the two entries swapped.

### Added

- Periodic credential/token reconciliation, a backstop on top of Prompt
  43's directory watch (Prompt 44). User, after that fix: "this won't
  happen again or do we need to place more guardrails?" — the watch is
  real and proven, but `fs.watch()` itself isn't unconditionally
  guaranteed by Node across every platform/condition. A 5-minute timer
  now unconditionally re-reads both the token and DB-credential files
  (shared logic with the watch, not a second implementation) and
  live-verifies the Vault token itself (`auth/token/lookup-self`) —
  populating its real remaining TTL for the first time ever, and
  actually reconsidering `authenticated` on a genuine `403` instead of
  it being a permanent one-way ratchet. Verified live end-to-end: waited
  for a real scheduled tick (no code sped up) to confirm normal
  operation; revoked arcanium-api's live Vault token directly and waited
  for the next tick to confirm detection, with real evidence recorded,
  not a guess; then forced a fresh Agent re-authentication and confirmed
  the existing directory watch recovered it within seconds, proving the
  two mechanisms work together — the watch as the fast path, the timer
  as the guaranteed-eventually backstop.

### Changed

- Moved `arcanium-vault-agent` from `compose/arcanium/compose.yaml` to
  `compose/vault/compose.yaml` (Prompt 45), consolidating everything
  Vault-related — Vault itself, and now its Agent — under one compose
  stack. User: "it feels right when everything Vault is in one place."
  Pure reorganization, not a behavior change: its auth/render logic,
  healthcheck, and security settings (`cap_drop`, `read_only`, `user`)
  are untouched. The compose-level `depends_on: arcanium-vault-agent`
  on arcanium-api/api-dev/worker (impossible across compose projects)
  became an explicit health-poll step in `scripts/rehydrate-stack.sh`,
  positioned at the same relative point in the sequence vault-agent
  used to implicitly start at — this matters because
  `ARCANIUM_VAULT_ROLE_ID`/`SECRET_ID` are only freshly issued by the
  step *after* it; starting vault-agent any earlier would bake stale
  or empty credentials into its environment (it does not re-read
  `.env` live). `vault-agent-secrets` is now owned by the vault
  project (`arcanium-vault_vault-agent-secrets`) and referenced as
  `external: true` from the arcanium side. As a side effect, `make
  down` now also correctly stops `arcanium-vault-agent` (`vault-down`
  already did a blanket stop of its whole project) — closing a gap
  found live the same week where the arcanium stack's own stop line
  never named it explicitly.

### Fixed

- `external-supplier` (the Control Group demo workload) never carried
  any Arcanium API credential — a gap predating Prompt 18's real auth,
  masked until now because it only worked when
  `ARCANIUM_AUTH_ENABLED=false` (`requireSession` auto-grants an
  identity in that mode; this deployment always runs with real auth
  on). `POST /api/v1/approvals` correctly 401'd every time (Prompt 49).
  Found live exercising the approval demo end-to-end for the first
  time this session. Fixed by minting it a real Prompt 28
  service-account token (`scenarios/05_approval/provision.sh`, role
  `operator` — the minimum MATRIX grant `POST /api/v1/approvals`
  needs) and wiring it through as `Authorization: Bearer` — no
  `arcanium-api` changes, the mechanism already existed. Verified live:
  the workload registered a real approval request, and the maturity
  score jumped from level 2 to level 4 as a direct result (`AUD-01`
  went from `UNKNOWN` to satisfied).
- `GET /api/v1/suppliers` (and the `/:id`, `/:id/applications`,
  `/:id/keys` detail routes) never used `teamReadScope()` (Prompt 27,
  Deliverable 3) — a team-scoped identity with no estate-wide read role
  (e.g. `arcanium-auditor:team:platform`) saw *every* supplier, not just
  its own team's. `applications`/`controls`/`reconciliation` were
  already wired into this; `suppliers.js` was missed (Prompt 47). Found
  live during a real UI walkthrough: registered a team linked to one
  supplier, signed in as the pre-seeded scoped demo account, and the
  Suppliers page still showed every supplier. Fixed by composing
  `tenantScope()` + `teamReadScope()` in the list route (same pattern
  already used in `applications.js`) and adding a `scopedReadDenied()`
  check to the three by-id routes, closing the same class of "list
  filters, direct-by-id doesn't" gap Prompt 27 already fixed elsewhere.
  Verified live with real accounts: the scoped identity now sees only
  its team's supplier and gets a clean 404 (not a leak) reaching
  another supplier directly by id; the estate-wide `operator` role is
  unaffected.
- `compose/vault/compose.yaml`'s new `arcanium-vault-agent` service block
  (Prompt 45) had a `container_name: arcanium-vault-agent` that didn't
  actually match — a transcription slip, most likely picked up from the
  `vault_s`/`vault_1`/`vault_2`/`vault_3` container names immediately
  above it in the same file, all of which use an underscore. The service
  key and `hostname:` correctly used the hyphen; only `container_name:`
  didn't, so the container silently came up as `arcanium-vault-agent`
  while `rehydrate-stack.sh`'s health-poll (and every other reference —
  `capture-state.sh`, the fitness suite, `vault.js`/`config.js`
  comments) looked for `arcanium-vault_agent` (or vice versa, depending
  on which was "correct" at any given moment) — reported as a false
  "did not report healthy" failure even though the container was
  actually up. Resolved by adopting the underscore consistently (`user`
  preference, matching `vault_s`/`vault_1/2/3`'s existing convention in
  that file) and updating every functional reference across the repo
  that targets the container by name. `scripts/clean-slate.sh` still has
  one such reference and needs the same update — it's off-limits to
  Claude (separate, user-owned in-progress work), so it wasn't touched
  here.
- A brand-new `vault-agent-secrets` volume (created fresh the first
  time under its new Prompt-45 project-qualified name) crash-looped
  `arcanium-vault-agent` on "permission denied" — Podman seeds new
  named volumes root-owned, and the container runs non-root
  (`user: "1000:1000"`, `read_only`, `cap_drop: [ALL]`). Found live
  during Prompt 45's own rehydrate proof (983 restarts before
  diagnosis); root-caused by reproducing the failure outside compose
  with a bare `podman run` (ruling out an initial, wrong suspicion
  that `HOME`/token-helper resolution was at fault). Fixed with an
  idempotent one-shot ownership fix
  (`podman run --user 0:0 ... chown -R 1000:1000 /vault/secrets`)
  added to `rehydrate-stack.sh`'s vault-agent step, ahead of
  `compose.sh vault up -d` — a harmless no-op once ownership is
  already correct, so a real fresh-clone rehydrate is covered too, not
  just this one migration.
- Credential rotation silently stopped after the first pickup, ever
  (Prompt 43) — a real, live production-availability bug, found the hard
  way: a day after the previous session, sign-in started failing with a
  genuine Postgres `password authentication failed` error. `vault.js`
  used `fs.watch()` on the individual `token` and `db-creds.json` files;
  Vault Agent writes both atomically (write a temp file, then rename it
  over the target) — exactly the pattern that permanently kills a
  single-file `fs.watch()`, since the watch is bound to that file's
  original inode and nothing re-arms it once a rename replaces that
  inode, with no error raised either. Confirmed live: Agent's own logs
  showed 4 successful credential renders overnight; arcanium-api's logs
  showed exactly 1 pickup, ever — the very first one, then silence.
  Reproduced the exact mechanism in an isolated script before touching
  any code (`watch(FILE_PATH)`: 4 renames, 0 events observed) and
  confirmed the fix survives the identical test (`watch(DIRECTORY)`,
  filename-dispatched: all 4 observed). Verified live against the real
  running Vault Agent too, not just the isolated repro: forced three
  rapid credential rotations in a row (`podman restart
  arcanium-vault-agent` × 3) and confirmed arcanium-api picked up every
  single one, immediately, each time — the exact scenario that used to
  silently break after the first. Immediate live mitigation (a container
  restart) was applied the moment the bug was found, before the
  permanent fix was written. Full regression green: fitness suite
  (39/0/0), negative-auth (31/0), verify-stack (53/1/0).

- Four findings from a fresh, independently-run review with no prior
  project context (Prompt 42), all confirmed live before and after:
  - **False "unhealthy" readiness.** `arcanium-api` had been sitting
    `unhealthy` in `podman ps` for hours at a stretch (confirmed live:
    `FailingStreak: 232`) while fully functional the whole time.
    `/health/ready` inferred credential staleness from a locally-computed
    `fileWriteTime + lease_duration`, on the assumption that Vault
    Agent's template re-renders before the credential goes stale — false:
    Agent renews the same lease in place, silently, for hours; the
    template only re-renders on a genuinely new credential. Fixed by
    asking Vault directly (`sys/leases/lookup`, using the `lease_id`
    the template already rendered but never used) for the lease's real,
    continuously-accurate TTL — verified live with arcanium-api's own
    real AppRole token, not root. Cached 30s to avoid a live Vault call
    on every readiness poll.
  - **`DELETE /api/v1/applications/:id` destroyed governance history.**
    `approval_requests.app_id` was `ON DELETE CASCADE` — reproduced live
    with a disposable fixture: an approved destroy request (including
    its real Vault Control Group authorization) vanished with the
    application, no trace. `desired_state.application_id` had no
    `ON DELETE` clause, so an application WITH reconciliation history
    instead failed the delete outright. Both foreign keys are now
    `ON DELETE SET NULL` (migration `025`) — checked first that
    `scenarios/17_terraform_provider`'s `terraform destroy` relies on
    this route succeeding for a fresh, no-history application, so the
    fix couldn't be "require offboarding first." Reproduced the original
    bug, then reran the identical fixture after the fix: the approval
    row now survives, every column intact, only the dangling app link
    nulled.
  - **OpenAPI mislabeled that route "Deprovision."** Corrected to
    describe what it actually does (registry-only, no Vault
    interaction, history-preserving) and points to the real governed
    teardown, `POST /:id/offboard`.
  - **The fitness suite's "no hard-delete of evidence" check was
    source-text only** and structurally couldn't see the schema-level
    cascade above — it passed the whole time that bug was live. Added a
    schema-aware companion check (`pg_constraint`, live against the
    running database) that queries for exactly this class of bug instead
    of grepping for a literal `DELETE FROM` statement.
  - Full regression green: fitness suite (39/0/0 — the only suite that's
    ever been fully clean twice in a row), negative-auth (31/0),
    terraform-provider scenario (8/0, confirming the no-history case is
    unaffected), verify-stack (53/1/0, `arcanium-api` now genuinely
    reporting healthy). State captured pre/post.

- The last two tolerated items on the board (Prompt 41), both traced to
  the same root cause. `payments-api-key`'s `rotation_period`
  desired_state row (`{days: 30}`) had sat DRIFTED against Vault's real
  `auto_rotate_period: 0` since an earlier fitness-test cleanup — closed
  for real via the existing `POST /reconciliation/:run_id/reconcile`
  path (not by lowering the declared policy to match Vault's neglected
  state): Vault's `auto_rotate_period` is now genuinely 30 days,
  confirmed `COMPLIANT` by a live confirmation run. That, in turn, was
  the actual cause of the fitness suite's long-standing webhook-delivery
  check `unk`: it picks one `rotation_period` row as a fixture and
  matches its live-observed value to force a known-COMPLIANT baseline —
  found live that it always landed on `payments-api-key`'s row, whose
  observed value was `0` (rotation disabled), and `PATCH /reconciliation/
  desired-state/:id` correctly rejects a desired value of 0 days
  ("must be a positive number") — not flakiness, a deterministic failure
  every run. Fixed at the source, and the fixture selection itself
  hardened so a future rotation-disabled key can't reintroduce the same
  trap: the check now runs reconciliation once for every row and picks
  the first whose observed value is genuinely positive, instead of
  trusting an arbitrary `LIMIT 1` row regardless of its observed value.
  Fitness suite: 38/0/0 — the first fully clean run this project has
  had.

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
