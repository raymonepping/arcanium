# Repository layout

A source-oriented map. Dependency directories, build outputs, secret files,
licence contents and runtime volume data are intentionally omitted.

```text
arcanium/
├── README.md                  Project entry point
├── CONTRIBUTING.md             Contribution guidance
├── CHANGELOG.md                Release history
├── Makefile                   Build, runtime and scenario commands
├── arcanium/
│   ├── api/
│   │   ├── src/
│   │   │   ├── auth/          Optional human sessions and persona scoping
│   │   │   ├── evidence/      Audit metadata ingestion
│   │   │   ├── maturity/      Server assessment (checks, scorer, report)
│   │   │   ├── migrations/    Ordered SQL migrations
│   │   │   ├── provisioner/   Jobs, dispatch and rollback steps
│   │   │   ├── routes/        HTTP contracts
│   │   │   ├── suppliers/     Live tenant-isolation check
│   │   │   ├── telemetry/     Dependency-free Prometheus metrics
│   │   │   ├── utils/         Shared helpers
│   │   │   ├── index.js       API entrypoint
│   │   │   └── worker.js      Optional background worker
│   │   ├── test/
│   │   └── Containerfile
│   ├── cli/                   API command-line client
│   └── ui/
│       ├── app/
│       │   ├── assets/css/    Semantic design system
│       │   ├── components/    Reusable UI (dialogs, pagination, topology)
│       │   ├── composables/   Typed API access and shared state
│       │   ├── layouts/       Navigation shell
│       │   ├── pages/         Nuxt routes
│       │   ├── types/         API models
│       │   └── utils/         Pure display / error helpers
│       ├── public/            Public assets
│       ├── server/            Same-origin gateway transport
│       └── Containerfile
├── compose/
│   ├── arcanium/              API, UI and worker services
│   ├── vault/                 Seal provider and Raft cluster
│   ├── infra/                 PostgreSQL and Adminer
│   ├── hsm/                   PKCS#11 proxy and HSM Vault
│   ├── identity/              Keycloak (OIDC broker) and OpenLDAP
│   ├── workloads/             Demonstration clients
│   ├── observability/         Optional Prometheus / Grafana / OTel
│   └── kms-sim/               Optional emulated cloud KMS
├── terraform/                 Baseline and demonstration desired state
│   └── arcanium-provider/     terraform-provider-arcanium skeleton (Go, unpublished)
├── workloads/                 Transit, signing, PKI, supplier and KMIP clients
├── scenarios/                 Operational demonstration scripts
├── scripts/                   Bootstrap, builds and diagnostics
├── docs/                      This documentation set
│   ├── frontend/              Frontend design-toolchain/quality-gate reports + config/DESIGN.md
│   └── writing/               Documentation style-toolchain/quality-gate reports + config/STYLE.md
├── input/                     Design source material
├── prompts/                   Implementation briefs and history
├── vault-1/ … vault-3/        Main cluster configuration
├── vault-s/                   Transit seal configuration
└── vault-hsm/                 HSM image and configuration
```

`architecture.md` and `usage.md` moved into `docs/` on 2026-09-10, and the
frontend moved from `ui/` to `arcanium/ui/` alongside `arcanium/api` and
`arcanium/cli`. See the [documentation index](index.md) for component detail.
Generated or local directories (`.secrets/`, `vault-tls/`, backups, Terraform
state) are operational material, not source examples.
