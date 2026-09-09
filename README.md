# Arcanium

Arcanium is a collection of security demonstration stacks for Vault,
infrastructure, HSM experiments, the Arcanium application, observability and
test workloads.

Podman is the canonical container runtime. Project commands use `podman`,
`podman build` and `podman compose`; they do not depend on the active Docker
CLI context or Docker Desktop socket.

## Prerequisites

- Podman 5 or newer
- a running Podman machine on macOS
- `podman-compose` as the preferred Compose provider
- GNU Make

Verify the local runtime:

```sh
make check
```

The project pins `podman-compose` when it is installed. This prevents
`podman compose` from silently selecting another external provider. Override
`PODMAN_COMPOSE_PROVIDER` only when deliberately testing compatibility.

## Commands

```sh
make help
make status
make storage
make network
make compose-config
```

Stacks are independent Compose projects:

```sh
make infra-up
make vault-up
make hsm-up
make arcanium-up
make observability-up
make workloads-up
```

Vault is implemented: [Vault setup and recovery](compose/vault/README.md).
`make vault-up` bootstraps vault-s plus the three-node Raft cluster.

For other stacks, the corresponding `compose/<stack>/compose.yaml` must exist. Until a stack is
implemented, its command exits with a clear message instead of pretending to
start an empty environment. See [compose/README.md](compose/README.md).

## Runtime and persistent state

Containers, images, build cache and named volumes live inside the Podman
machine on macOS. Treat container state as disposable. Important state needs
an explicit named volume plus a tested export or backup outside the VM.

`make storage` reports current usage and performs no cleanup. `make vault-backup`
saves and inspects both Vault Raft snapshots on the Mac. Future persistent
services need their own backup workflows; a generic volume copy is not
considered a verified backup.

On Apple Silicon, use native `linux/arm64` images by default. A future Vault
Enterprise HSM proof of concept may declare `platform: linux/amd64` where that
product constraint requires it; that emulated setup is for testing, not a
production support claim.

## License

[GPLv3](LICENSE)
