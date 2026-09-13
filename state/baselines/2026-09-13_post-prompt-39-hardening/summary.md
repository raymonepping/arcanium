# arcanium baseline — 2026-09-13_post-prompt-39-hardening

**Purpose:** post: LIKE-wildcard escaping, maturity scoring, capture-state live checks, live CG verification, request-approval drift window
**Captured:** 2026-09-13T17:32:40Z
**Source commit:** 959508f
**Previous baseline:** 2026-09-13_pre-prompt-39-hardening
**Overall capture status:** CAPTURED

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
| kms | CAPTURED |
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
