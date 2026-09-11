# Bootstrap, restart, recreate, and reset

Pre-24, Deliverable 10. Answers: *I cloned the repo onto a machine with the prerequisites installed. How do I recreate the Arcanium lab without relying on facts that exist only on the original developer's laptop?*

These are four different procedures — using the wrong one either does far more than intended (a "restart" that quietly wipes state) or leaves the estate in an inconsistent state (a "recreate" that assumes credentials nobody reissued). See [`docs/persistence.md`](persistence.md) for the PERSIST/REHYDRATE/REISSUE/EPHEMERAL model these all build on.

```text
first-ever bootstrap    empty machine -> working local estate
normal restart          stop/start, all persistent data expected to remain
container recreation    containers replaced, volumes kept, config reconciled
full destructive reset  make reset-demo — everything gone, start over
```

Prompt 24 owns a fifth: backup restore (measured RTO/RPO, disaster recovery). A volume surviving `podman compose down` is not disaster recovery, and this page does not claim it is.

## Prerequisites

- Podman + a running Podman machine (macOS), `podman-compose`.
- GNU Make, Terraform, the Vault CLI, `jq`, OpenSSL, `curl`.
- Node 24 for local API/UI development (container builds carry their own runtime).
- Vault Enterprise binaries/licenses for the capabilities being demonstrated — not every license enables every feature (PKCS#11, KMIP, namespaces, Sentinel, key distribution); `make check-entitlements` reports what the configured license actually covers.
- The HSM/workload build targets use the host's own architecture now (`Makefile`'s `uname -m` detection, fixed this prompt — previously hardcoded to `linux/amd64`, requiring emulation on Apple Silicon).

## Required secret inputs

Never committed; every one of these must come from the operator, not from this repository:

| Input | Source |
|---|---|
| `VAULT_LICENSE`, `VAULT_LICENSE_ENT` | Your own Vault Enterprise license files |
| `POSTGRES_PASSWORD` | Chosen locally |
| `SOFTHSM_SO_PIN`, `SOFTHSM_USER_PIN` | Chosen locally |
| `LDAP_ADMIN_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD` | Chosen locally |
| `ARCANIUM_OIDC_CLIENT_SECRET` | Printed once by `compose/identity/keycloak/setup_keycloak.sh`, pasted into `.env` |
| Every `*_VAULT_ROLE_ID` / `*_VAULT_SECRET_ID` | **No longer a manual step for `arcanium-api`, `arcanium-hsm-read`, `document-signing`** — `scripts/workload-credentials.sh issue-all` (or `make rehydrate`) issues these. `payments-workload`/`pki-workload` come from `make onboarding`; supplier/approver roles from `make supplier-provision`/`make approval-provision` — all reissue automatically as part of `make rehydrate`. |

## First-ever bootstrap

```sh
cp .env.example .env
chmod 600 .env
# fill in the "Required secret inputs" above, then:
make rehydrate
```

`make rehydrate` runs [`scripts/rehydrate-stack.sh`](../scripts/rehydrate-stack.sh)'s full sequence: network, Vault (init/unseal), Terraform baseline, infra, HSM, identity (LDAP + Keycloak realm), Terraform workloads/kmip/suppliers, Arcanium API/UI/worker, every workload credential, the workloads stack, then verification. Every step is the same idempotent script/target `make up`/`make down`/normal operation already uses — first-ever bootstrap is not a special code path, just the full sequence run starting from nothing.

`scripts/rehydrate-stack.sh list` prints the numbered sequence without running anything; `--core` stops before the optional workloads/observability/kms-sim tail; `--from N` resumes from a given step (useful if an early step needs a manual fix — e.g. pasting the printed `ARCANIUM_OIDC_CLIENT_SECRET` into `.env` before continuing past the identity step).

## Normal restart

```sh
make down    # stops every stack — NEVER deletes a named volume
make up      # brings the core stack back from existing persistent state
```

Expected, per [`docs/persistence.md`](persistence.md)'s component table: PostgreSQL rows, Vault Raft state (all three instances), the SoftHSM token, and the Keycloak/LDAP directories all survive. `make up` is idempotent — Vault is not reinitialized, Terraform applies produce no unwanted changes (see [`docs/resource-ownership.md`](resource-ownership.md) for the two places that isn't quite true today and why), and `identity-bootstrap` reconciles rather than recreates the realm.

**Workload credentials are the one thing a normal restart does not, by design, carry forward automatically for containers created before this restart.** If `payments-api`/`pki-client`/`document-signing`/etc. were already running and are only being `stop`/`start`ed (not recreated), their environment doesn't change and they keep working. If they're being recreated, run `make workload-credentials-issue` (or the fuller `make onboarding`/`make supplier-provision`/`make approval-provision` as needed) **before** `make workloads-up` — or just use `make rehydrate`, which sequences this correctly.

## Container recreation (volumes kept)

```sh
make down
podman rm -f <container>              # or: ./scripts/compose.sh <stack> down; up -d again
make rehydrate
```

`make rehydrate` is the safe default here rather than `make up`, because recreation is exactly the case that needs config reconciliation (Keycloak/LDAP bootstrap rerun, harmless against existing state) and credential reissuance (recreated containers need their RoleID/SecretID freshly present, not whatever `.env` happened to hold before). This is the exact failure this prompt started from — see [`docs/persistence.md`](persistence.md#the-vault_role_id-failure-class) — proven live: three real workload containers had been recreated before their credentials existed and needed exactly this sequence to recover.

## Full destructive reset

```sh
make reset-demo
```

Named unmistakably, requires typing `arcanium` to confirm, and is the **only** Makefile target that calls `down -v`. Deletes every named volume: PostgreSQL, all Vault instances (including the SoftHSM-held private key — **never reconstructible from Git**, see `docs/persistence.md`), LDAP, Keycloak, observability history. Never hidden behind `make clean` — no target named `clean` exists in this Makefile. After a reset, the only path back is first-ever bootstrap (`make rehydrate` from scratch).

## Verification

```sh
make workload-credentials-verify     # every workload's RoleID/SecretID actually logs in
make verify                          # scripts/verify-stack.sh — full smoke test
make scenario-persistence-restart    # the hostile restart/recreate/credential-loss proof (Deliverable 9)
make scenario-security-foundation    # negative-auth still passes after any of the above
make scenario-reconciliation         # drift detection still passes after any of the above
make supplier-test                   # 2x2 tenant isolation still passes after any of the above
```

`state/scripts/capture-state.sh` records a `persistence` block and a `restart_persistence: PASS|FAIL|UNKNOWN` result — see its own extension in this prompt.
