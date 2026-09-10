# Setup

This guide provisions a local demonstration environment. Run from the repository root and review each phase before applying it. Commands such as Terraform apply, onboarding and supplier provisioning change Vault/database state.

## Prerequisites

- Podman and a running Podman machine on macOS.
- `podman-compose`, GNU Make, Vault CLI, Terraform, `jq`, OpenSSL and `curl`.
- Node 24 for local API/UI development; container builds supply their own runtime.
- Appropriate Vault Enterprise binaries and licenses for the capabilities being demonstrated.
- Available loopback ports listed in [architecture](architecture.md).

```sh
make check
make help
```

The HSM/application build targets use `linux/amd64`. On Apple Silicon this requires working emulation. Do not substitute arbitrary Vault binaries or assume every Enterprise license enables PKCS#11, KMIP, namespaces, Sentinel or key distribution.

## Configuration

Create `.env` from `.env.example` only when it does not already exist. Preserve an existing working configuration.

```sh
test -f .env || cp .env.example .env
chmod 600 .env
```

Fill the required values privately. PostgreSQL administration credentials configure Vault's database connection; the API obtains its own short-lived database credentials from Vault. See [configuration](configuration.md).

## Core Vault and infrastructure

```sh
make network
make vault-prepare
make vault-up
make vault-status
make infra-up
```

Vault preparation generates the local TLS material and prepares license files. Bootstrap initializes only new state, creates the Transit seal arrangement and joins the main Raft cluster. Read [Vault setup](../compose/vault/README.md) before recovering existing volumes.

Set the Vault CLI address and trusted CA for Terraform/CLI operations:

```sh
export VAULT_ADDR=https://127.0.0.1:18200
export VAULT_CACERT="$PWD/vault-tls/ca-chain.pem"
```

Authenticate through your configured operator method. Bootstrap scripts keep initialization output under `.secrets/vault`; never paste it into a document or commit it.

## Vault platform configuration

The Makefile exposes these core modules:

```sh
make tf-platform
make tf-transit
make tf-pki
make tf-database
```

These targets apply Terraform with automatic approval. For review before applying:

```sh
make tf-init TF_STACK=vault-platform
make tf-plan TF_STACK=vault-platform
```

The API needs `ARCANIUM_VAULT_ROLE_ID` and `ARCANIUM_VAULT_SECRET_ID` in `.env`. Obtain the role ID and create a SecretID for the configured Arcanium AppRole using the authorized operator workflow described in [Arcanium services](../compose/arcanium/README.md). Keep the SecretID private.

## Start Arcanium

```sh
make arcanium-up
curl -fsS http://localhost:3001/health/ready
```

Open [localhost:3000](http://localhost:3000). A successful UI response alone does not establish that Vault and PostgreSQL are ready.

## Optional workloads and tenants

Depending on the demonstration:

```sh
make tf-workloads
make tf-kmip
make tf-suppliers
make onboarding
make kmip-provision
make supplier-provision
make approval-provision
make workloads-up
```

These are state-changing steps. Consult the relevant module/scenario first; credential-generation scripts may update `.env.workloads`. Start workloads after their credentials, policies, keys and certificates exist.

## Optional Sentinel policy enforcement

Sentinel EGPs enforce key rotation to automation-only identities and guard key destruction. The licence feature must be present.

```sh
export VAULT_TOKEN=$(jq -r .root_token .secrets/vault/cluster-init.json)
export VAULT_CACERT="$PWD/vault-tls/ca-chain.pem"
export VAULT_ADDR=https://127.0.0.1:18200
make tf-sentinel
```

The `make tf-sentinel` target sets the token internally, but the above exports are available as a manual fallback.

After applying, classify platform-tier workloads to prevent them lowering the Access Control dimension:

```sh
arcanium applications classify payments-api --category platform
arcanium applications classify pki-client   --category platform
```

Then verify enforcement and check the maturity score:

```sh
make scenario-automation-depth
curl -fsS http://localhost:3001/api/v1/maturity | jq '{level,levelName,overall}'
```

## Optional HSM, KMS and observability

- [HSM setup](../compose/hsm/README.md): proxy/token bootstrap, Vault HSM initialization and Managed Key custody.
- [KMS emulator](../compose/kms-sim/README.md): LocalStack KMS and distribution scenarios.
- [Observability](../compose/observability/README.md): Prometheus, Grafana and the OTel collector. This is independently enabled and can be completed later.

## Verify

Start with read-only checks:

```sh
make vault-status
curl -fsS http://localhost:3001/health
curl -fsS http://localhost:3001/api/v1/cluster
```

`make verify` is a broader demonstration smoke test that creates/changes records and exercises operations. Inspect [its script](../scripts/verify-stack.sh) before using it against retained data. Test failure scenarios only when a service interruption is intended.
