# Compose stacks

Arcanium uses independent Compose projects with one future `compose.yaml` per
stack:

```text
compose/
├── vault/compose.yaml
├── infra/compose.yaml
├── hsm/compose.yaml
├── arcanium/compose.yaml
├── observability/compose.yaml
└── workloads/compose.yaml
```

The Vault stack is implemented; see [vault/README.md](vault/README.md).
The other files will be added when their services are implemented. The repository
does not include empty placeholder Compose definitions because `make <stack>-up`
must never report success without starting the intended services.

Each stack uses the explicit project name `arcanium-<stack>`. Services that
communicate across stacks should join the external network `arcanium`, created
with `make network`.

Use named volumes for runtime data. Document and implement an export or backup
outside Podman's VM before treating any state as durable. Never bind-mount
credentials from a committed path.
