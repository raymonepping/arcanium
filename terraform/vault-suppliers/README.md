# terraform/vault-suppliers

Provisions two isolated Vault Enterprise namespace tenants for supplier isolation demonstration.

## What it provisions

| Resource | Description |
|---|---|
| `vault_namespace.pepsi` | `suppliers/pepsi` namespace |
| `vault_namespace.cocacola` | `suppliers/cocacola` namespace |
| AppRole auth backends | One per namespace |
| Transit engines | One per namespace, RSA-4096 signing keys |
| Workload policies | sign/verify with Control Group on delete |
| Approver policies | sys/control-group/authorize |
| Identity entities + aliases + groups | Per-namespace approver identity chain |
| Rate-limit quotas | 60 req/min per namespace (root-level) |

## Usage

```bash
export VAULT_TOKEN=$(jq -r .root_token .secrets/vault/cluster-init.json)
make tf-suppliers
```

## After apply

Generate workload and approver AppRole credentials:

```bash
make supplier-provision
```

Run the full 2×2 isolation test matrix:

```bash
make supplier-test
```
