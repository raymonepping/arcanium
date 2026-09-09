# Bootstrap — Vault Terraform prerequisites

This module documents the manual steps required before running any Terraform
module against the Arcanium Vault cluster.

## 1. Export the root token

The root token is written to `.secrets/vault/cluster-init.json` by `vault-bootstrap.sh`.

```bash
export VAULT_TOKEN=$(jq -r '.root_token' .secrets/vault/cluster-init.json)
export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT=$(pwd)/vault-tls/ca-chain.pem
```

> **Security note** — The root token should be revoked after initial platform
> setup and a scoped operator token created instead. For this POC the root
> token is retained for convenience.

## 2. Verify connectivity

```bash
vault status
vault token lookup
```

## 3. Apply modules in order

```bash
make tf-platform   # auth + policies + namespace + audit
make tf-transit    # transit engine + demo keys
make tf-pki        # root CA + intermediate CA + PKI roles
# vault-database was applied in prompt 01:
make tf-database   # already applied — idempotent
```

## 4. Verify

```bash
vault auth list
vault secrets list
vault policy list
vault namespace list
```

## State files

All state is stored locally under `.secrets/terraform/` which is gitignored.
There is no remote backend for this POC.

| Module          | State file                                 |
|-----------------|--------------------------------------------|
| vault-platform  | `.secrets/terraform/vault-platform.tfstate`|
| vault-transit   | `.secrets/terraform/vault-transit.tfstate` |
| vault-pki       | `.secrets/terraform/vault-pki.tfstate`     |
| vault-database  | `.secrets/terraform/vault-database.tfstate`|
