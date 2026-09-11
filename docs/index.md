# Documentation index

The root [README](../README.md) is the project entry point. This index groups the
guides by task. All documentation lives in `docs/`; only `README.md`,
`CONTRIBUTING.md`, `CHANGELOG.md` and `LICENSE` sit at the repository root.

## Start here

- [Architecture](architecture.md): services, trust boundaries, data flows and persistence.
- [Usage](usage.md): daily commands and the demonstration walkthrough.
- [Repository layout](repository-layout.md): source-oriented map of the tree.

## Setup and operation

- [Setup](setup.md): prerequisites, configuration and first boot.
- [Operations](operations.md): lifecycle commands, rebuilds, backups and checks.
- [Troubleshooting](troubleshooting.md): common failures and diagnostic paths.
- [Configuration](configuration.md): environment variables and ownership.
- [Capabilities and limitations](capabilities.md): implemented, optional and unverified behaviour.
- [Release checklist](release-checklist.md): release and validation discipline.

## Development and contracts

- [API reference](api.md): implemented HTTP routes and semantics.
- [API development](../arcanium/api/README.md)
- [CLI usage](../arcanium/cli/README.md)
- [UI development](../arcanium/ui/README.md)
- [Contributing](../CONTRIBUTING.md)
- [Runtime orchestration](orchestration.md): how intent becomes Vault configuration.
- [Authentication and personas](personas.md)
- [Security](security.md): OIDC trust model, deny-by-default authorization matrix, session/CSRF/header hardening (Prompt 18).

## Cryptography and assurance

- [Managed Keys](managed-keys.md): PKCS#11 custody on the HSM instance.
- [Key distribution](key-distribution.md): the Key Management engine and the emulated KMS.
- [Policy as code](policy-as-code.md): Sentinel EGPs.
- [Maturity model](maturity-model.md): the server-side assessment.
- [Security model](security.md)
- [Scenario guide](scenarios.md)

## Component guides

- [Compose overview](../compose/README.md)
- [Vault](../compose/vault/README.md)
- [HSM](../compose/hsm/README.md)
- [Infrastructure](../compose/infra/README.md)
- [Arcanium services](../compose/arcanium/README.md)
- [Workloads](../compose/workloads/README.md)
- [Observability](../compose/observability/README.md)
- [KMS emulator](../compose/kms-sim/README.md)
- [Terraform bootstrap](../terraform/bootstrap/README.md)
- [Database secrets](../terraform/vault-database/README.md)
- [KMIP](../terraform/vault-kmip/README.md)
- [Supplier isolation](../terraform/vault-suppliers/README.md)

## Keeping documentation accurate

Runtime behaviour comes from source code, configuration and observed responses.
Files in `prompts/` record design intent and implementation history; they are not
evidence that a feature is active. After changing routes, environment variables,
scoring or Compose membership, update the relevant reference here and re-check
the relative Markdown links.

Never include live tokens, PINs, passwords, private keys, licence strings or
initialisation output in documentation. Use placeholders and describe where an
operator obtains the real values.
