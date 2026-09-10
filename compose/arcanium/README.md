# Arcanium management stack

Two independently built services:

| Service | Host | Networks |
| --- | --- | --- |
| `arcanium-ui` | `127.0.0.1:3000` | `arcanium-control` |
| `arcanium-api` | `127.0.0.1:3001` | control and Vault-internal |

The UI uses Nuxt. The API uses Express and PostgreSQL metadata with Vault-backed cryptographic services. The optional worker source runs separately when queue/ingestion capabilities are enabled; inspect Compose for whether it is actually configured.

## Prerequisites

Complete [setup](../../docs/setup.md): running Vault and PostgreSQL, trusted TLS, baseline policies, database secrets engine, and valid Arcanium AppRole credentials.

The API's role ID and SecretID are supplied through `.env`. Obtain them with an authorized operator workflow after platform provisioning. Never publish their values. The API obtains dynamic PostgreSQL credentials at startup and refreshes them through Vault.

## Build and run

```sh
make arcanium-up
```

For frontend-only iteration:

```sh
./scripts/ui-rebuild.sh
```

The helper rebuilds/recreates only the UI. API changes require an API rebuild and recreation too. Read [UI development](../../arcanium/ui/README.md) and [operations](../../docs/operations.md).

## Checks

```sh
curl -fsS http://localhost:3001/health/live
curl -fsS http://localhost:3001/health/ready
curl -fsS http://localhost:3001/api/v1/cluster
```

A UI liveness probe is not a Vault readiness check. Healthy standbys should remain healthy in the topology view.

## Changes and migrations

Numbered SQL migrations in `arcanium/api/src/migrations/` are applied at startup. Add migrations for schema changes rather than editing applied files. Provisioning mode, human authentication, HSM enrichment, evidence ingestion and telemetry are optional and require explicit configuration.

See [API reference](../../docs/api.md), [configuration](../../docs/configuration.md) and [security model](../../docs/security.md) for current semantics and limits.
