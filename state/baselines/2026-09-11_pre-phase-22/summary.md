# arcanium baseline — 2026-09-11_pre-phase-22

**Purpose:** Prompt 22 — pre-execution baseline (OpenAPI / State Machines / CI)
**Captured:** 2026-09-11T12:43:39Z
**Source commit:** f208388
**Previous baseline:** 2026-09-11_post-phase-21-complete
**Overall capture status:** PARTIAL

## Capture status per check

| Check | Status |
|---|---|
| source | CAPTURED |
| runtime | CAPTURED |
| arcanium | CAPTURED |
| vault | UNKNOWN |
| hsm | CAPTURED |
| identity | PARTIAL |
| infra | UNKNOWN |
| kms | CAPTURED |
| observability | CAPTURED |
| workloads | CAPTURED |
| verification | CAPTURED |

## Observed functional verification

- **supplier_isolation**: UNKNOWN — endpoint requires an authenticated session (ARCANIUM_AUTH_ENABLED=true) — not run anonymously
- **oidc_discovery**: PASS
- **reconciliation**: UNKNOWN — endpoint requires an authenticated session (ARCANIUM_AUTH_ENABLED=true) — not run anonymously
- **maturity**: UNKNOWN — endpoint requires an authenticated session (ARCANIUM_AUTH_ENABLED=true) — not run anonymously
- **onboarding**: UNKNOWN — not run — mutating scenario, requires --with-scenarios and creates/changes real resources
- **transit**: UNKNOWN — not run — mutating scenario, requires --with-scenarios and creates/changes real resources
- **pki**: UNKNOWN — not run — mutating scenario, requires --with-scenarios and creates/changes real resources
- **kmip**: UNKNOWN — not run — mutating scenario, requires --with-scenarios and creates/changes real resources
- **managed_key**: UNKNOWN — not run — mutating scenario, requires --with-scenarios and creates/changes real resources
- **sentinel_negative**: UNKNOWN — not run — mutating scenario, requires --with-scenarios and creates/changes real resources

See [manifest.yaml](./manifest.yaml) for the machine-readable form, and
[source/project-tree.md](./source/project-tree.md) for the captured project structure.

## Project context

ARCANIUM_AUTH_ENABLED = true

Arcanium is a Vault Enterprise cryptographic control-plane demo:
`arcanium/{api,ui,cli}` + Vault (3-node Raft + transit-seal + HSM) +
OpenLDAP/Keycloak identity (Prompt 18) + supplier-tenant workloads.
