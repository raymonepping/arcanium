# Arcanium API

Express 5 application using JavaScript ESM. The API integrates with Vault and PostgreSQL and remains the authoritative backend for the Nuxt UI and CLI.

## Entry points

- `src/index.js`: API startup, dependency initialization, migrations and route registration.
- `src/worker.js`: optional queued provisioning and audit ingestion worker.
- `src/config.js`: configuration contract.
- `src/vault.js`: Vault authentication, credential refresh and operations.
- `src/migrations/`: ordered database migrations.
- `src/provisioner/`: job dispatch and step/rollback orchestration.
- `src/maturity/`: server-side assessment formulas/report.

## Development

```sh
npm ci
npm test
npm start
```

Startup requires configured Vault/TLS/AppRole and PostgreSQL settings. The API obtains database credentials from Vault; `npm start` is not a standalone in-memory demo. See [setup](../../docs/setup.md) and [configuration](../../docs/configuration.md).

Existing tests have varying scope. Add targeted tests for new routes and validators; do not assume a mirrored test implementation validates the production route.

## Contracts

See [API reference](../../docs/api.md), [orchestration](../../docs/orchestration.md), [personas](../../docs/personas.md) and [maturity](../../docs/maturity-model.md). Keep business rules here rather than in Nuxt proxy routes. Return safe, explicit unavailable/error states and distinguish metadata changes from cryptographic operations.

Schema changes should use a new numbered migration. Review data preservation, rollback behavior, tenant scoping and job state before changing lifecycle routes.
