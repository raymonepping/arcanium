# Arcanium baseline — 2026-09-11_post-phase-18-complete

**Purpose:** Prompt 18 Security Foundation complete — 13/13 negative-auth assertions pass, HSM fixed, UI CSP/auth-state fixed, code committed at cb2c73e
**Captured:** 2026-09-11T09:25:11Z
**Overall capture status:** PARTIAL

## Characteristics at capture time

```text
AuthN
  ARCANIUM_AUTH_ENABLED = true
  Vault userpass (pre-Phase-18)

AuthZ
  Persona based, username -> persona map
  Not yet OIDC group backed

Desired state / Reconciliation
  Not implemented (pre-Phase-19)

Evidence
  v1 / heuristic (pre-Phase-21 in this repo's numbering)

Maturity
  Averaged model, not gated

OpenAPI
  Not authoritative (pre-Phase-20)

Recovery
  Backups available, restore not yet proven (pre-Phase-22)
```

## Capture status per check

| Check | Status |
|---|---|
| source | CAPTURED |
| runtime | CAPTURED |
| arcanium | UNKNOWN |
| vault | UNKNOWN |
| hsm | CAPTURED |
| infra | CAPTURED |
| kms | UNKNOWN |
| observability | CAPTURED |
| workloads | CAPTURED |
| scenarios | CAPTURED |

See [manifest.yaml](./manifest.yaml) for the machine-readable form, and
[scenarios/summary.md](./scenarios/summary.md) for the observed-functional-state results.
