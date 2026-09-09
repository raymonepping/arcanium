# Vault Database Secrets Engine — Arcanium PostgreSQL

Configures Vault to manage dynamic PostgreSQL credentials for the Arcanium API.

## Credential model

```
.env (POSTGRES_USER / POSTGRES_PASSWORD)
    └──► Terraform applies once → Vault stores connection internally
                                       └──► Arcanium API: vault read database/creds/arcanium-api-role
                                                └──► { username: v-arcanium-xK9p, password: <random>, ttl: 3600 }
                                                        └──► pg connection (in memory, auto-renewed)
                                                                └──► lease expires → Vault drops the role
```

## Prerequisites

1. PostgreSQL is running: `make infra-up`
2. Vault cluster is healthy: `make vault-status`
3. Root token exported: `export VAULT_TOKEN=$(jq -r '.root_token' .secrets/vault/cluster-init.json)`

## Apply

```bash
cd terraform/vault-database

terraform init

terraform apply \
  -var="postgres_user=$(grep POSTGRES_USER ../../.env | cut -d= -f2)" \
  -var="postgres_password=$(grep POSTGRES_PASSWORD ../../.env | cut -d= -f2)" \
  -var="postgres_db=$(grep POSTGRES_DB ../../.env | cut -d= -f2)"
```

Or via Makefile: `make tf-database`

## Verify

```bash
export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=vault-tls/ca-chain.pem
export VAULT_TOKEN=$(jq -r '.root_token' .secrets/vault/cluster-init.json)

vault read database/creds/arcanium-api-role
# Key                Value
# ---                -----
# lease_id           database/creds/arcanium-api-role/...
# username           v-arcanium-...
# password           <random>
```

## State file

Stored locally at `.secrets/terraform/vault-database.tfstate` (gitignored).

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `vault_addr` | `https://127.0.0.1:18200` | Vault API address |
| `vault_cacert` | `../../vault-tls/ca-chain.pem` | CA certificate path |
| `postgres_host` | `postgres` | Hostname inside `arcanium-control` network |
| `postgres_port` | `5432` | PostgreSQL port |
| `postgres_user` | — | Superuser (sensitive, pass via `-var` or `TF_VAR_`) |
| `postgres_password` | — | Superuser password (sensitive) |
| `postgres_db` | `arcanium_db` | Database name |
