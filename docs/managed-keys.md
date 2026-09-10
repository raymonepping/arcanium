# Managed Keys — application key custody in SoftHSM (Prompt 14.1)

## The two PKCS#11 integrations

From `input/02` §9 — these are completely different:

| | What protects what | Arcanium |
|---|---|---|
| **HSM as a Vault seal** | SoftHSM holds Vault's root/seal key. Auto-unseal, seal wrap. | `vault-hsm` `seal "pkcs11"` — since Prompt 02. |
| **HSM as application key custody** | SoftHSM holds an *application's* private key. Vault Transit delegates crypto to the token; the key material never enters Vault's barrier. | **This document.** `sys/managed-keys/pkcs11/docsign-hsm`. |

## Topology decision

The plain `hashicorp/vault-enterprise:2.1.0-ent` binary that `vault-1/2/3` run
**cannot do PKCS#11 managed keys** — it returns `unsupported managed key type`.
Only the `+ent.hsm` binary can, and `vault-hsm` is the only node with it.

**Chosen:** run the Managed Key on `vault-hsm`, and give the Arcanium API a
read-only AppRole there so the key still appears in the inventory with correct
custody. Trade-off: the Managed-Key demo lives on a node separate from the main
Transit/PKI/KMIP cluster, and the API reads from two Vaults (`vault-1` for the
cluster, `vault-hsm` for this one key). The alternative — rebuilding `vault-1/2/3`
from a custom `.hsm` image and rolling-restarting the live Raft cluster — was
judged too invasive for the value.

## The chain

```
document-signing workload
        │  AppRole login → vault-hsm
        ▼
vault-hsm  transit/sign/document-signing-key      (type = managed_key)
        │
        ▼
sys/managed-keys/pkcs11/docsign-hsm   library = "softhsm-proxy"
        │  PKCS#11 (CKM_RSA_PKCS)
        ▼
libpkcs11-proxy.so ──TLS-PSK──▶ softhsm-server:2345 ──▶ SoftHSM2 token
        ┌───────────────────────────────┐
        │ RSA-4096 private key           │  generated here (allow_generate_key),
        │ label: docsign-hsm-rsa         │  never exported
        └───────────────────────────────┘
```

`vault-hsm/config-hsm.hcl` carries a `kms_library "pkcs11" { name = "softhsm-proxy" }`
stanza alongside the existing `seal "pkcs11"` block — same proxy library, same token.

## Build / rebuild

```bash
make hsm-bootstrap        # build image, start softhsm-server, resolve slot, start vault-hsm
make hsm-init             # initialise vault-hsm, write .secrets/vault/vault-hsm-init.json
make hsm-managed-keys     # scripts/vault-hsm-bootstrap.sh — engines + managed key + roles
#  → prints ARCANIUM_HSM_ROLE_ID / ARCANIUM_HSM_SECRET_ID for .env
#  → writes DOCSIGN_VAULT_ROLE_ID / DOCSIGN_VAULT_SECRET_ID to .env.workloads
make arcanium-build && make arcanium-up   # API picks up the vault-hsm read client
make workloads-build && make workloads-up # document-signing re-points to vault-hsm
```

Terraform equivalent (`terraform/vault-managed-keys/`) documents the same desired
state; apply it with a `vault-hsm` root token exported as `VAULT_TOKEN`.

## Verify

```bash
# Managed key present, key material in SoftHSM
vault read sys/managed-keys/pkcs11/docsign-hsm      # (against vault-hsm)

# Transit key is managed_key type
vault read transit/keys/document-signing-key         # type = managed_key

# Workload still signs + verifies, tamper still fails
podman logs --tail 20 arcanium-document-signing

# Arcanium surfaces the custody
curl -s localhost:3001/api/v1/keys | jq '.[] | select(.name=="document-signing-key")'
#   "custody": "SoftHSM (PKCS#11 Managed Key)", "hsm_backed": true
```

## Honest claim

SoftHSM2 is a **software** PKCS#11 module. What this demonstrates is the
*architecture* and *non-exportability* of the key — not tamper-resistant hardware
assurance or FIPS certification. In production the same Vault configuration points
`kms_library` at a real HSM's PKCS#11 library.
