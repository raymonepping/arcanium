# arcanium baseline — 2026-09-12_pre-frontend-design-toolchain

**Purpose:** Before executing 00_frontend_design_toolchain.md + 00_frontend_quality_gate.md
**Captured:** 2026-09-12T18:03:52Z
**Source commit:** 5ed8bec
**Previous baseline:** 2026-09-12_post-prompt-28-external-integration-key-lifecycle
**Overall capture status:** PARTIAL

## Capture status per check

| Check | Status |
|---|---|
| source | CAPTURED |
| runtime | CAPTURED |
| arcanium | CAPTURED |
| vault | CAPTURED |
| hsm | CAPTURED |
| identity | CAPTURED |
| infra | CAPTURED |
| kms | UNKNOWN |
| observability | CAPTURED |
| workloads | CAPTURED |
| persistence | CAPTURED |
| verification | CAPTURED |

## Observed functional verification

- **supplier_isolation**: UNKNOWN — endpoint requires an authenticated session (ARCANIUM_AUTH_ENABLED=true) — not run anonymously
- **oidc_discovery**: PASS
- **reconciliation**: UNKNOWN — endpoint requires an authenticated session (ARCANIUM_AUTH_ENABLED=true) — not run anonymously
- **maturity**: UNKNOWN — endpoint requires an authenticated session (ARCANIUM_AUTH_ENABLED=true) — not run anonymously
- **intent_view**: UNKNOWN — endpoint requires an authenticated session (ARCANIUM_AUTH_ENABLED=true) — not run anonymously
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
