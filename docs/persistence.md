# Persistence, rehydration and restart behavior

**[`config/persistence-manifest.yaml`](../config/persistence-manifest.yaml) is the authoritative, machine-readable inventory** (pre-24) — this page is the narrative companion. If the two ever disagree, the manifest (checked directly against the compose files) is correct; treat the disagreement as a doc bug here.

Three concepts, kept deliberately distinct throughout this repository:

```text
PERSIST    Runtime data whose loss changes the logical estate.
           Example: PostgreSQL rows, Vault Raft data, LDAP directory data,
           the SoftHSM token holding a non-exportable private key.

REHYDRATE  Configuration reconstructed from Git-controlled source.
           Example: Keycloak realm/client/federation config, Vault
           baseline config (Terraform), demo LDAP users/groups, container
           images built from source.

REISSUE    Credentials regenerated at runtime, never committed.
           Example: AppRole SecretIDs, the OIDC client secret, service
           tokens.
```

A volume surviving `podman compose down` is not disaster recovery. An idempotent bootstrap script is not a backup. A backup existing is not proof of restoration. This page and Prompt 24 (measured recovery, RTO/RPO, restore drills) answer different questions — see [Relationship to Prompt 00 and Prompt 24](#relationship-to-prompt-00-and-prompt-24) below.

## Component table

| Component | Persistent asset | Compose volume/path | Normal restart | Recreate container | `down -v` |
|---|---|---|---|---|---|
| PostgreSQL | applications, desired state, reconciliation, approvals, evidence, sessions, control assessments | `postgres-data:/var/lib/postgresql/data` | survives | survives | destroyed |
| Vault main (vault-1/2/3) | Raft: mounts, policies, AppRoles, Transit keys, PKI/KMIP config | `vault-N-data`, `vault-N-audit` | survives | survives | destroyed |
| Vault seal provider (vault-s) | Raft (Transit seal for the main cluster) | `vault-s-data`, `vault-s-audit` | survives | survives | destroyed |
| Vault HSM (vault-hsm) | Raft (Managed Key registration) | `vault-hsm-data`, `vault-hsm-audit` | survives | survives | destroyed |
| SoftHSM | non-exportable RSA-4096 key material | `softhsm-data:/var/lib/softhsm` | survives | survives | **destroyed — unrecoverable** |
| OpenLDAP | directory entries | `ldap-data`, `ldap-config` | survives | survives | destroyed |
| Keycloak | realm/client/federation/group-mapper config | `keycloak-data:/opt/keycloak/data` | survives (fixed this prompt) | survives (fixed this prompt) | destroyed |
| LocalStack (KMS sim) | none — intentionally disposable | *(none)* | lost by design | lost by design | n/a |
| Prometheus / Grafana | dashboards = code; time-series = optional | `prometheus-data`, `grafana-data` | survives | survives | destroyed (history only) |
| Arcanium API/UI/worker | none — fully replaceable | *(none)* | n/a | n/a | n/a |
| Workload credentials | none — REISSUE by design | `.env` / `.env.workloads` (gitignored) | **not** re-read on plain restart | must reissue before recreate | n/a |

Never use `down -v` in a normal stop/start target — see [Deliverable 7](#platform-liferecycle-contract) below.

## The `VAULT_ROLE_ID` failure class

The concrete failure that motivated this prompt:

```text
Error: [config] Missing required env var: VAULT_ROLE_ID
```

Traced to its actual root cause rather than papered over: `arcanium-api`, `arcanium-hsm-read` and `document-signing` had **no automated credential path at all** before this prompt — `docs/setup.md` documented a one-time manual `vault write -f .../secret-id` and hand-paste into `.env`. RoleID/SecretID values are `REISSUE`, not `PERSIST` — they are deliberately absent from any volume, so a container created before its pair existed in `.env`/`.env.workloads` starts with the variable simply unset. Podman/Docker fix container environment at creation time; a plain `stop`/`start` never re-reads it.

Fixed by [`scripts/workload-credentials.sh`](../scripts/workload-credentials.sh) (`issue`, `verify`, `issue-all`, `verify-all`, `list`) — see [`config/persistence-manifest.yaml`](../config/persistence-manifest.yaml)'s `workload_credentials` entry for the full mapping. It deliberately does **not** duplicate `scenarios/01_onboarding/run.sh`, `scenarios/06_supplier_isolation/provision.sh` or `scenarios/05_approval/provision.sh` — those already generate and idempotently rewrite `payments-workload`, `pki-workload`, the supplier/approver roles and `external-supplier` into `.env.workloads`, and are exercised by working, tested scenarios. This script covers exactly the identities nothing else covered.

Proven live during this prompt, not just in theory: three already-running workload containers (`payments-api`, `pki-client`, `document-signing`) had been created before their credentials existed and were crash-looping on this exact error; recreating them (not merely restarting — env vars needed to change) after `scripts/workload-credentials.sh issue document-signing` and the existing `make onboarding` output resolved it, verified via each workload's own log line for a real Vault operation (Transit encrypt, PKI cert issue, Transit sign + tampered-payload-rejected verify).

## Keycloak: persistence model chosen

Model **A** — persist Keycloak's own database, keep bootstrap idempotent as reconciliation (the prompt's other option, treating configuration as fully disposable and rebuilding from `start-dev` state every time, was rejected as unnecessary complexity for a local reference architecture where `start-dev`'s embedded H2 database already gives a working persistent store for free once mounted).

Before this prompt: `start-dev` stored its H2 database under `/opt/keycloak/data` with no volume — a container recreation silently lost the realm, the LDAP federation, the client, and the group-claim mapper. Fixed: `keycloak-data:/opt/keycloak/data` is now a named volume (`compose/identity/compose.yaml`). `compose/identity/keycloak/setup_keycloak.sh`'s `ensure_realm`/`ensure_ldap_federation`/`ensure_client`/`ensure_group_claim_mapper` functions were already idempotent — safe to rerun against an already-configured realm — so the one missing piece really was the volume, not the bootstrap logic.

## LocalStack (KMS simulation): classified disposable, honestly

No named volume, deliberately — `compose/kms-sim/README.md` already documented the required honest behavior before this prompt: recreating the emulator loses its state independently of Vault's own Key Management engine metadata, and Arcanium already reports the resulting mismatch as `unreachable` rather than a stale `synced`. This prompt only formalizes the classification (`EPHEMERAL` in the manifest); no behavior changed.

## Relationship to Prompt 00 and Prompt 24

```text
Prompt 00        observe / record state
      ↓
Pre-24           persist + rehydrate + restart deterministically   (this page)
      ↓
Prompt 24        destroy / restore / measure (RTO/RPO, restore drills)
```

This page does not claim production HA, build PostgreSQL/Keycloak HA, or claim disaster recovery. Its scope: a normal restart or container recreation must not erase Arcanium's logical estate, and everything that should be reconstructed must be reproducible from code rather than memory.

## Platform lifecycle contract

See the Makefile: `make up` / `make down` / `make restart` / `make rehydrate` / `make verify`. `make down` never calls `down -v`, `volume prune`, or any equivalent destructive command — see [`docs/bootstrap.md`](bootstrap.md) for the full command sequence and [`docs/resource-ownership.md`](resource-ownership.md) for what each Terraform module versus Arcanium's own runtime provisioning owns.
