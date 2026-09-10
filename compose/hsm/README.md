# HSM demonstration stack

The current stack uses two services: `softhsm-server` and `vault-hsm`. The former runs SoftHSM2 behind a PKCS#11 proxy. The latter loads the proxy library and sends PKCS#11 calls over TLS with a PSK.

```text
vault-hsm (+ent.hsm, linux/amd64)
  └─ libpkcs11-proxy.so
       └─ TLS: softhsm-server:2345
            └─ SoftHSM token storage (persistent volume)
```

This avoids loading the SoftHSM library directly into an incompatible Vault userspace. The previous one-shot Alpine `softhsm-init` topology is not the current Compose implementation.

## Start

Configure the license, token label, PINs, PSK file and slot input described in `.env.example` and the bootstrap scripts.

```sh
make hsm-bootstrap
make hsm-init
```

The bootstrap builds the HSM image, starts the proxy, resolves its token slot and starts Vault HSM. Initialization output belongs in the protected `.secrets/vault` path, not console transcripts or Markdown.

For later starts/stops:

```sh
make hsm-up
make hsm-logs
make hsm-down
```

Host API: `https://127.0.0.1:18300`. Container name: `arcanium-vault_hsm`. Both services use the Vault-internal network; the PKCS#11 daemon is not a public browser endpoint.

## Seal versus application custody

The PKCS#11 seal protects Vault's seal/unseal lifecycle. A PKCS#11 Managed Key protects a particular application's key custody. One does not prove the other is configured.

```sh
make hsm-managed-keys
```

See [Managed Keys](../../docs/managed-keys.md) for the signing-key demonstration and optional API metadata reader. Verify actual binary capabilities and license entitlements; do not infer them solely from a filename or a previous environment's license.

## Persistent material

The Compose volumes hold SoftHSM tokens, Vault HSM data and audit logs. The proxy PSK, PIN custody, slot file and Vault recovery material are also required for recovery. Changing environment PINs does not reinitialize existing tokens.

SoftHSM is software emulation. This demonstrates PKCS#11 integration and custody architecture, not tamper-resistant hardware or certification.
