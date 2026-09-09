# Arcanium API Stack

## Overview

The Arcanium API is the **management plane** — it registers applications,
manages crypto profile metadata in PostgreSQL, and exposes Vault inventory.
Workloads call Vault directly for crypto operations; this API never proxies
plaintext or ciphertext.

## Network topology

```
Host (localhost:3001)
  └── arcanium-api (arcanium-control + arcanium-vault-internal)
        ├── postgres (arcanium-control → dynamic credentials via Vault)
        └── vault-1/2/3 (arcanium-vault-internal → AppRole auth)
```

## Prerequisites

1. `make vault-up` — Vault cluster running and bootstrapped
2. `make infra-up` — PostgreSQL running
3. `make tf-platform` — AppRole + policies provisioned in Vault
4. `make tf-transit` — Transit engine + keys provisioned
5. `make tf-pki` — PKI root + intermediate CA provisioned
6. `make tf-database` — Dynamic DB credentials configured

## Generate AppRole credentials (one-time)

```bash
export VAULT_TOKEN=$(jq -r '.root_token' .secrets/vault/cluster-init.json)
export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=$(pwd)/vault-tls/ca-chain.pem

# Get role_id (also available from: make tf-platform output)
vault read auth/approle/role/arcanium-api/role-id

# Generate a secret_id
vault write -f auth/approle/role/arcanium-api/secret-id
```

Add both values to `.env`:

```bash
ARCANIUM_VAULT_ROLE_ID=<role_id>
ARCANIUM_VAULT_SECRET_ID=<secret_id>
```

## Build and start

```bash
make arcanium-build
make arcanium-up
```

## Verify

```bash
# Liveness
curl http://localhost:3001/health/live

# Readiness (requires vault + db)
curl http://localhost:3001/health/ready

# Full status
curl http://localhost:3001/health | jq .

# Register an application
curl -s -X POST http://localhost:3001/api/v1/applications \
  -H "Content-Type: application/json" \
  -d '{"name":"payments-api","description":"Demo payment service"}' | jq .

# List applications
curl -s http://localhost:3001/api/v1/applications | jq .

# List transit keys
curl -s http://localhost:3001/api/v1/keys | jq .

# PKI CA chain
curl -s http://localhost:3001/api/v1/pki/ca-chain
```

## Credential rotation

`vault.js` manages two rotation lifecycles automatically:

| Credential | Refresh at | On failure |
|---|---|---|
| Vault token (AppRole) | 80% of TTL | Retry with backoff; `/health/ready` → 503 if exhausted |
| DB credentials | 75% of lease duration | Retry with backoff; old pool drained after new pool opens |

## Migrations

SQL migrations are applied automatically on startup from `arcanium/api/src/migrations/`.
Files are applied in filename order; already-applied files are skipped.
To add a migration, create `arcanium/api/src/migrations/002_name.sql`.

## Logs

```bash
make arcanium-logs
```

Log format:
```
[startup] arcanium-api listening on port 3001 (production)
[req] POST   /api/v1/applications 201 12ms
[vault] db credentials rotated (user=v-approle-...)
```
