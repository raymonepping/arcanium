# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
