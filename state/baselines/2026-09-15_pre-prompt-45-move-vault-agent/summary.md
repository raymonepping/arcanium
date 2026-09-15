# arcanium baseline — 2026-09-15_pre-prompt-45-move-vault-agent

**Purpose:** pre: move arcanium-vault-agent from compose/arcanium to compose/vault (stack currently fully down)
**Captured:** 2026-09-15T08:46:53Z
**Source commit:** c20f3ba
**Previous baseline:** 2026-09-15_post-prompt-44-periodic-reconciliation
**Overall capture status:** PARTIAL

## Capture status per check

| Check | Status |
|---|---|
| source | CAPTURED |
| runtime | CAPTURED |
| arcanium | UNKNOWN |
| vault | UNKNOWN |
| hsm | UNKNOWN |
| identity | UNKNOWN |
| infra | UNKNOWN |
| kms | UNKNOWN |
| observability | UNKNOWN |
| workloads | UNKNOWN |
| persistence | CAPTURED |
| verification | CAPTURED |

## Observed functional verification

- **supplier_isolation**: UNKNOWN — arcanium-api not running
- **oidc_discovery**: UNKNOWN — realm discovery document not captured or missing issuer field
- **reconciliation**: UNKNOWN — arcanium-api not running
- **maturity**: UNKNOWN — arcanium-api not running
- **intent_view**: UNKNOWN — arcanium-api not running
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
