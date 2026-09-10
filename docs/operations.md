# Operations

## Daily inspection

```sh
make check
make status
make vault-status
make storage
```

`make storage` reports usage without pruning. Use `podman ps -a` when you need all container names/statuses; actual names are authoritative over older prose.

| Signal | Meaning |
| --- | --- |
| UI container healthy | Frontend HTTP process responds |
| API `/health/live` | API process responds |
| API `/health/ready` | API Vault authentication and database checks pass |
| API `/api/v1/cluster` | Per-node Vault health observation |
| Workload health | That workload's probe passes, not necessarily every operation succeeds |

Healthy Raft standby nodes must not be described as failed simply because they return HTTP 429 from Vault health.

## Start and stop

For an initialized environment, start Vault and infrastructure before the API. Start workloads once their credentials are valid. Stop workloads before their dependencies when shutting down intentionally.

```sh
make vault-up
make infra-up
make arcanium-up
make workloads-up
```

The HSM, observability and KMS simulation stacks are independent. Starting `arcanium` does not automatically configure all optional dependencies.

`make <stack>-down` retains declared named volumes. `down -v`, volume removal and pruning are not restart procedures.

## Logs

```sh
make arcanium-logs
make arcanium-ui-logs
make vault-logs
make workloads-logs
```

Logs may contain operational identifiers and backend errors. Inspect locally and redact before sharing. Do not publish `.env`, secret files, Vault initialization output or raw audit logs.

## UI rebuild

```sh
./scripts/ui-rebuild.sh
./scripts/ui-rebuild.sh --logs
```

The revised helper creates a source archive on the host and streams it to Podman. This avoids relying on stale VM-mounted source files. It builds first, recreates only the UI service, and exits nonzero if build/start/health validation fails. The runtime health probe uses Node's HTTP client; `node:24-slim` does not supply `wget` by default.

The UI build installs the lockfile with `npm ci`. Local dependencies and generated `.nuxt`/`.output` directories are excluded from the container context. A rebuild does not apply API source changes; rebuild/recreate the API separately when its routes changed.

## API migrations and worker

Numbered migrations run during API startup. Review new SQL before restarting an environment with important data. Do not edit an already-applied migration to change live schema; add a new migration.

`PROVISION_MODE=queue` requires a worker configured with the same Vault/database access. Inspect `/api/v1/jobs` for pending, running and failed steps. The presence of `src/worker.js` alone does not launch it. The worker also supports audit ingestion when configured.

A job marked `rolled_back` still requires inspection of rollback steps: undo is best effort and individual rollback steps can fail.

## Backup and recovery

```sh
make vault-backup
```

This saves and inspects snapshots for vault-s and the main Raft cluster outside the Podman VM. Inspection proves readability, not a successful restore exercise.

Keep protected copies of:

- Vault snapshots and the corresponding seal/recovery material.
- TLS trust/private material and licenses.
- PostgreSQL logical backups, including job/evidence/session metadata as appropriate.
- SoftHSM token storage, proxy PSK and required PIN custody for the HSM demonstration.
- Terraform state and deployment configuration.

The current Vault snapshot helper is not a complete PostgreSQL or HSM backup solution. Define and test those recovery paths separately before depending on retained state.

After a VM restart, `vault-s` may need unsealing. Use `make vault-up` and [Vault recovery guidance](../compose/vault/README.md); do not reinitialize existing Vault volumes. Recovery shares do not replace a lost Transit seal key or lost HSM token.

## Verification boundaries

Read-only checks are suitable for routine diagnostics. `make verify`, provisioning, evidence scenarios, key distribution and failure scripts perform mutations. In particular, quorum-loss and leader-failure exercises deliberately disrupt service. Use the [scenario guide](scenarios.md) to select the intended exercise.
