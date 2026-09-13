# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
