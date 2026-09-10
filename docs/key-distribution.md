# External key custody & distribution (Prompts 14.1 · 14.3 · 15.5)

Arcanium demonstrates all three enterprise key-management patterns:

```
1. CRYPTO-AS-A-SERVICE     App ─────────────▶ Vault Transit        ✓ payments-api, document-signing
2. STANDARD KEY MGMT       Consumer ──KMIP──▶ Vault (as KMS)       ✓ kmip-client
3. EXTERNAL KEY CUSTODY    Vault ───────────▶ external HSM / KMS   ← this document
```

Pattern 3 has **two** real demonstrations, because "external key custody" and
"external key distribution" are different things.

---

## Model B — external key *custody* (SoftHSM Managed Key)  ·  the primary demo

`document-signing-key` on `vault-hsm` is a **PKCS#11 Managed Key**
(`terraform/vault-managed-keys/`, Prompt 14.1). Vault never holds the private
key material — every sign/verify is delegated to the SoftHSM token through the
PKCS#11 library. The key is generated in the HSM and cannot be exported from it.

```
document-signing workload ──▶ Vault Transit (vault-hsm) ──PKCS#11──▶ SoftHSM token
                                    (delegates crypto)         (holds the key)
```

This *is* external key custody: the custodian of the key is a device outside
Vault's storage barrier. The keys page shows `document-signing-key` with an
**HSM-backed** chip and custody `SoftHSM (PKCS#11 Managed Key)`. Verified end to
end — a tampered payload fails verification inside the token, not in Vault.

Licence: **HSM Auto-Unseal / Seal Wrapping + Managed Keys**, present in the
2.1-ent licence and only usable by the `+ent.hsm` binary (`vault-hsm`). The plain
`+ent` nodes return *"unsupported managed key type"*.

---

## Model C — external key *distribution* (Key Management secrets engine)

The `keymgmt/` engine generates a key that Vault **owns**, then pushes a *copy*
into an external cloud KMS and manages its lifecycle there (distribute → rotate →
the copy follows → remove).

### No real cloud account is used

The operator deliberately does not connect AWS / Azure / GCP. Instead the
distribution **lifecycle** runs against an **emulated KMS** — LocalStack's `kms`
service, `compose/kms-sim/` — reached through the `awskms` provider with an
`endpoint` override:

```
keymgmt/kms/localstack:
  provider    = awskms
  credentials = { access_key = test, secret_key = test,
                  endpoint   = http://arcanium-localstack:4566,
                  region     = us-east-1 }
```

This exercises the genuine engine code path — the same API calls Vault makes
against real AWS KMS — with nothing leaving the machine. Everything distributed
this way is labelled **`emulated · LocalStack`** in the UI and API
(`GET /api/v1/keymgmt` → `providers[].emulated: true`). It is never presented as
a real cloud KMS.

A real cloud KMS is the same configuration with the `endpoint` override removed
and real credentials supplied — a change the lab intentionally does not make.

### Run it

```bash
make kms-sim-up            # start LocalStack (KMS only, 127.0.0.1:4566)
make tf-keymgmt            # mounts keymgmt/, creates arcanium-distributed,
                           # and (because kms-sim is up) distributes it
scenarios/10_key_distribution/run.sh   # full lifecycle demo
```

`scenarios/10_key_distribution/run.sh` shows: distribute → the copy appears in
the emulated KMS → rotate the Vault key → the emulated copy gains a version →
stop LocalStack → `GET /api/v1/keymgmt` reports the target as **`unreachable`**,
not a fabricated success.

> **LocalStack Community does not persist state.** Recreating the
> `arcanium-localstack` container leaves Vault's `keymgmt` engine referencing
> KMS keys that no longer exist. The scenario script resets the engine at the
> start of each run; `restart: unless-stopped` keeps the container alive between
> runs.

### API / UI

| | |
|---|---|
| `GET /api/v1/platform/entitlements` | licence features + capability flags |
| `GET /api/v1/keymgmt` | engine state, keys, per-target distribution status (`in-sync` / `unreachable`), `emulated` flag |
| `POST /api/v1/keymgmt/:name/rotate` | operator persona — rotate the Vault-owned key |
| `POST /api/v1/keymgmt/:name/sync` | operator persona — (re-)push a key to a target |

The keys page **External Key Distribution** panel renders
`arcanium-distributed → awskms  [emulated · LocalStack] [in-sync] v1`, or the
honest "no KMS provider configured" / "unreachable" states.

Licence: **Key Management Secrets Engine (ADP-KM)**, present in the 2.1-ent
licence.
