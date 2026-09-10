# Arcanium

Arcanium is a local enterprise cryptographic lifecycle demonstration platform built around HashiCorp Vault Enterprise. It brings suppliers, applications, keys, approvals, evidence and operational posture into one management experience.

Vault owns cryptographic state and enforces policies. Arcanium provides management APIs, orchestration, metadata and a Nuxt frontend. PostgreSQL stores application records and evidence; it is not a substitute for Vault key custody.

## Start here

| Document | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Services, trust boundaries, data flows and persistence |
| [Usage](docs/usage.md) | Daily commands and demonstration walkthrough |
| [Setup](docs/setup.md) | Prerequisites and first-time provisioning |
| [Operations](docs/operations.md) | Startup, rebuilds, verification and recovery |
| [API reference](docs/api.md) | Implemented routes and important semantics |
| [UI development](arcanium/ui/README.md) | Frontend structure, development and checks |
| [Troubleshooting](docs/troubleshooting.md) | Health, build, credentials and data issues |
| [Documentation index](docs/index.md) | All guides and component references |

## Platform

- **Management:** Nuxt 4, Vue 3, TypeScript and Express 5, with Node 24 container runtimes.
- **Custody:** three-node Vault Raft cluster, a separate Transit seal provider, and a Vault HSM demonstration instance backed by SoftHSM through a PKCS#11 proxy.
- **Tenancy:** supplier namespaces, workload identities, policies and quotas.
- **Lifecycle:** Transit, PKI, KMIP, optional Managed Keys, provisioning jobs and governed actions.
- **Assurance:** source-attributed governance records, optional audit-log ingestion, maturity evaluation and optional observability services.

This is a demonstration environment. Licensed capabilities, feature flags and running services determine which functions are available. SoftHSM is software emulation; LocalStack KMS is an optional cloud KMS emulator. See [capabilities and limitations](docs/capabilities.md).

## Run an already provisioned environment

From the repository root:

```sh
make check
make vault-up
make infra-up
make arcanium-up
```

Open [Arcanium](http://localhost:3000). The API is available on [localhost:3001](http://localhost:3001/health). Vault remains independently accessible at [localhost:18200](https://localhost:18200/ui/).

For a fresh environment, follow [setup](docs/setup.md) first. API startup requires configured Vault AppRole and database credentials; starting containers alone does not provision those prerequisites.

## Common commands

```sh
make help
make status
make vault-status
make storage
./scripts/ui-rebuild.sh
make arcanium-logs
```

Podman is the canonical runtime. `scripts/compose.sh` selects `podman-compose` by default and uses the repository `.env`. Containers and volumes live inside the Podman VM on macOS. Build targets for the application and HSM demonstration use `linux/amd64`; inspect each stack before assuming native architecture.

## Repository map

| Path | Contents |
| --- | --- |
| `arcanium/ui/` | Nuxt frontend and same-origin API transport |
| `arcanium/api/` | Express API, migrations, Vault client, provisioner, worker and scoring |
| `arcanium/cli/` | Command-line API client |
| `compose/` | Independently managed container stacks |
| `terraform/` | Vault bootstrap and demonstration infrastructure |
| `workloads/` | Encryption, PKI, signing, external supplier and KMIP clients |
| `scenarios/` | Onboarding, isolation, approvals, failures and evidence exercises |
| `scripts/` | Runtime, build, bootstrap and verification helpers |
| `docs/` | Operating and technical guides |
| `input/`, `prompts/` | Design inputs and implementation prompts; not runtime configuration |

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [CHANGELOG.md](CHANGELOG.md) for release history. Licensed under [GPLv3](LICENSE).
