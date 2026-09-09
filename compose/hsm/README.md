# Arcanium — HSM Stack

Demonstrates **PKCS#11 auto-unseal** using SoftHSM2 inside a Vault Enterprise
container. This is a standalone single-node Vault cluster — separate from the
production cluster (vault-1/2/3) — used purely to show the HSM seal mechanism.

## Architecture

```
softhsm-init (one-shot, Alpine)
  └── initialises token in softhsm-tokens volume
  └── exports libsofthsm2.so to softhsm-lib volume

vault-hsm (Vault Enterprise linux/amd64)
  ├── SoftHSM2 installed in image (apk add softhsm)
  ├── PKCS#11 seal configured in config-hsm.hcl
  ├── Token storage: softhsm-tokens volume (persistent)
  └── Port: 127.0.0.1:18300:8200
```

## Why linux/amd64?

Vault Enterprise HSM (PKCS#11 seal) is limited to `linux/amd64`. On Apple
Silicon, Podman Machine uses Rosetta to translate — acceptable for a POC.

## License coverage

| Feature | Covered by vault_v2.hclic |
|---------|--------------------------|
| PKCS#11 auto-unseal (seal stanza) | ✅ Yes (HSM feature) |
| Managed Keys / sys/managed-keys/pkcs11 | ❌ No (requires ADP-KM) |

This stack demonstrates the **seal** use case only.

## Start / stop

```bash
# First time — builds image, inits token, starts vault-hsm:
make hsm-bootstrap

# Subsequent starts (token already exists):
make hsm-up

# Stop:
make hsm-down

# Logs:
make hsm-logs
```

## Token details

Set in `.env`:

| Variable | Purpose |
|----------|---------|
| `SOFTHSM_TOKEN_LABEL` | Token label (default: `arcanium-hsm`) |
| `SOFTHSM_SO_PIN` | Security Officer PIN |
| `SOFTHSM_USER_PIN` | User PIN (used by Vault seal) |

## Ports

| Service | Host port | Purpose |
|---------|-----------|---------|
| vault-hsm | `127.0.0.1:18300` | Vault API |

## Validation

```bash
# Check token was initialised:
podman run --rm \
  -v arcanium-hsm_softhsm-tokens:/var/lib/softhsm/tokens \
  -e SOFTHSM2_CONF=/softhsm2.conf \
  docker.io/library/alpine:3.20 \
  sh -c "apk add -q softhsm && \
         printf '[tokens]\ndirectories.tokendir=/var/lib/softhsm/tokens/\n' > /softhsm2.conf && \
         softhsm2-util --show-slots"
# Expected: slot with label arcanium-hsm

# Check vault-hsm status:
VAULT_ADDR=https://127.0.0.1:18300 \
VAULT_CACERT=vault-tls/ca-chain.pem \
  vault status
# Expected: initialized=false (ready to init), seal_type=pkcs11
```

## Initialising vault-hsm

After `make hsm-bootstrap`, vault-hsm is sealed and uninitialised. Run:

```bash
export VAULT_ADDR=https://127.0.0.1:18300
export VAULT_CACERT=vault-tls/ca-chain.pem
vault operator init -key-shares=1 -key-threshold=1
```

With PKCS#11 seal, the unseal key is wrapped by the HSM — `vault operator unseal`
is not needed on normal restarts (the HSM auto-unseals). The recovery key output
by init is for emergency access only.
