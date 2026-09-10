# terraform/vault-kmip

Enables the Vault Enterprise KMIP secrets engine for the `legacy-database`
consumer workload.

## What it provisions

| Resource | Description |
|---|---|
| `vault_kmip_secret_backend.kmip` | KMIP engine at `kmip/`, listener on `0.0.0.0:5696` |
| `vault_kmip_secret_scope.arcanium` | Scope `arcanium` — root namespace, legacy consumer |
| `vault_kmip_secret_role.legacy_db` | Role `legacy-db`: create, get, get_attributes, locate, destroy |

## Usage

```bash
export VAULT_TOKEN=$(jq -r .root_token .secrets/vault/cluster-init.json)
make tf-kmip
```

## Prerequisites

- Vault Enterprise license with ADP-KM feature
- `vault-1/config.hcl` must include the KMIP TCP listener on port 5696
- `compose/vault/compose.yaml` must publish `127.0.0.1:15696:5696` on vault-1

## After apply

Generate the mTLS client certificate for the kmip-client workload:

```bash
make kmip-provision
```
