# Guided cryptographic onboarding (Prompts 15.1 · 16.1)

`/onboard` is the UI embodiment of the original Enigma **registratieproces** — the
"bottom blue" decision tree. The user states *intent*; Arcanium translates it into
Vault configuration and shows exactly what it did.

## The wizard

| Step | Asks | Produces |
|---|---|---|
| 1 · Service | existing tenant, or a new one (name, namespace, SLA tier) | — |
| 2 · Application | name, description, environment, criticality | — |
| 3 · Requirements | TLS/X.509? · symmetric? · signatures? · asymmetric? | — |
| 4 · Custody | Vault software key · SoftHSM Managed Key *(disabled — vault-hsm only)* · External KMS *(disabled)* | — |
| 5 · Review | the **Provisioning Preview** panel, populated | — |
| 6 · Result | live job steps mapped 1:1 against the preview, ✓/✗ | the onboarding package |

The **Provisioning Preview** panel (right side) fills in section-by-section as the
user advances, then flips to the *actual* job result. Every line is derived from
the form — nothing is invented.

## Requirement → Vault resource mapping

| Intent | Vault resource |
|---|---|
| *(always)* new tenant | namespace `suppliers/<name>` + AppRole + tenant policy + transit mount + rate-limit quota |
| *(always)* | Workload AppRole `<app>-workload` + least-privilege policy `<app>-workload` |
| Symmetric encryption *(and default)* | Transit key `<app>-key` · `aes256-gcm96` |
| Signatures **or** asymmetric encryption | Transit key `<app>-key` · `rsa-4096` (one key; RSA-4096 covers both symmetric-style and signing needs) |
| TLS / X.509 | PKI role `<app>-tls` on `pki-int`, `allowed_domains: <app>.arcanium.local` |
| *(always)* governance | auto-rotation 30 days · destroy requires an approval |

**One key, one type.** If both a symmetric and a signing need are checked, the
workload gets a single `rsa-4096` key — the preview and the provisioner agree.

## Correctness guarantees (Prompt 16.1)

- **Duplicate names are caught at the input step.** A tenant name already in the
  registry (step 1) or an application name already in use anywhere (step 2)
  blocks *Continue* with an inline message. The wizard never calls `createSupplier`
  and then dies on a `createApplication` 409.
- **No orphaned tenant.** `createSupplier` runs inside `provision()`. If a later
  step fails, a tenant created *in that run* is rolled back
  (`DELETE /api/v1/suppliers/:id`). If the rollback itself fails, the error names
  the tenant and points at the Suppliers page.
- **Readable failures.** Errors come through `apiErrorMessage()` — the gateway's
  sanitised `statusMessage`, never the boolean `error: true` flag. The Review step
  stays put and offers **Retry**.
- **Reliable Result step.** A successful `provision()` always advances to step 6
  and renders the real job steps; a `failed` job shows its failed step, not a dead
  end.

## API

`POST /api/v1/applications/:id/provision` body:

```jsonc
{
  "custody": "vault",              // "softhsm" only on vault-hsm
  "key_type": "aes256-gcm96",      // or "rsa-4096"
  "capabilities": ["encrypt", "decrypt", "sign", "verify"],
  "rotation_days": 30,
  "tls": true                      // → also create the pki-int role
}
```

## Guardrail

The wizard never shows raw Vault paths as the primary UX (drill-down only) and
never asks the user to think in `transit/` or `sys/mounts/` terms.
