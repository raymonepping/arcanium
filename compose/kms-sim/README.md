# kms-sim — emulated cloud KMS (Prompt 15.5)

One container: `localstack/localstack:3.8`, **KMS service only**, listening on
`127.0.0.1:4566`. It exists so the Key Management secrets engine's
**distribute → rotate → remove** lifecycle can be demonstrated end to end
**without connecting a real AWS / Azure / GCP account**. Nothing leaves the
machine.

```bash
make kms-sim-up      # start
make kms-sim-down    # stop
make tf-keymgmt      # mounts keymgmt/ and, if kms-sim is healthy, distributes
scenarios/10_key_distribution/run.sh
```

Vault reaches it as `http://arcanium-localstack:4566` (the container joins both
`arcanium-control` and `arcanium-vault-internal`). The `keymgmt/kms/localstack`
provider is an `awskms` provider with an `endpoint` override and dummy
credentials (`access_key=test`, `secret_key=test`).

## Honesty

- Everything distributed here is labelled **`emulated · LocalStack`** in the UI
  and `GET /api/v1/keymgmt` (`emulated: true`). It is never presented as a real
  cloud KMS.
- When this stack is down, the distribution status shows **`unreachable`**, not a
  fabricated success.
- A real cloud KMS is the same configuration with the `endpoint` override removed
  and real credentials supplied.

## Caveats

- **Pinned to Community `3.8`.** The rolling `latest` tag now refuses to boot
  without a LocalStack licence token.
- **Community LocalStack does not persist state.** Recreating the
  `arcanium-localstack` container leaves Vault's `keymgmt` engine referencing KMS
  keys that no longer exist (rotation/removal then error). `restart:
  unless-stopped` keeps it alive; `scenarios/10_key_distribution/run.sh` resets
  the engine at the start of each run.
