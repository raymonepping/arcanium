# Runtime orchestration — Arcanium translates intent into Vault config (Prompt 14.2)

Before this prompt, Arcanium was a registry + read layer: `POST /suppliers` wrote a
Postgres row and nothing in Vault. Terraform owned every runtime Vault resource.

Now Arcanium **owns the runtime lifecycle** (`input/08` — "Arcanium vertaalt business
intent naar Vault configuration"). Terraform stays the **bootstrap** authority.

## Who owns what

| | Terraform (`terraform/`) | Arcanium API (runtime) |
|---|---|---|
| Vault cluster config, auth methods, audit devices, baseline policies, root PKI, KMIP engine | ✅ | |
| The `suppliers` parent namespace, `arcanium` namespace | ✅ | |
| Seed demo workloads (`vault-workloads/`) so the stack is non-empty on first boot | ✅ | |
| A **new** supplier tenant (namespace + approle + policy + transit mount + quota) | | ✅ `POST /api/v1/suppliers` |
| A **new** application's workload identity + policy + Transit key | | ✅ `POST /api/v1/applications/:id/provision` |
| Key rotate / rewrap | | ✅ `POST /api/v1/keys/:name/rotate` \| `/rewrap` |
| Key destroy (governance-gated) | | ✅ `POST /api/v1/keys/:name/destroy` → approval |
| Application offboarding (governance-gated, Prompt 28) | | ✅ `POST /api/v1/applications/:id/offboard` → per-key approvals |

`terraform/vault-workloads/` is **not** removed — it still seeds the demonstration workloads. New resources go through the API.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/suppliers` | After the registry insert, runs the supplier provisioner. `?dry=true` skips provisioning. On provisioning failure the steps roll back **and** the registry row is removed. |
| `DELETE` | `/api/v1/suppliers/:id` | De-provisions the namespace (refuses one holding transit keys unless `?force=true`), then removes the row; linked applications or approval history can block deletion. |
| `POST` | `/api/v1/applications/:id/provision` | Body `{ custody, key_type, capabilities[], rotation_days }`. Creates the supported workload identity, policy and key resources. Uses the supplier's namespace if the app is bound, else root. Returns `202` + job. |
| `POST` | `/api/v1/keys/:name/rotate` | `transit/keys/:name/rotate`, recorded as a job. |
| `POST` | `/api/v1/keys/:name/rewrap` | `{ ciphertext }` → rewrapped ciphertext at the latest version. **The one crypto-data-plane call Arcanium makes** — ciphertext only, never plaintext. Operator/architect persona only. |
| `POST` | `/api/v1/keys/:name/destroy` | Records an `approval_requests` row (`action = revoke`), returns `202`. Does **not** delete the key — follow-up execution must be verified separately; the current approval-recording endpoint alone does not demonstrate deletion or native authorization. |
| `POST` | `/api/v1/applications/:id/offboard` | Prompt 28 — begins a governed offboarding workflow, not a cascade delete. Submits a `destroy_request` (same path as `/keys/:name/destroy`) for every still-active key; already-inactive keys are tombstoned immediately. `applications.offboarded_at` is only set once every submitted request has actually been resolved — see [external-integration.md](external-integration.md). |
| `GET` | `/api/v1/jobs` `?status=` | Provisioning job history. |
| `GET` | `/api/v1/jobs/:id` | One job with its ordered steps. |

## Jobs and rollback

`provisioning_jobs` (migration `005_provisioning.sql`) records every step:
`{ step, status, detail, at }`. If a step fails, the runner calls the `undo` of
every step that already succeeded, newest first, and marks the job `failed` (no
rollbackable steps) or `rolled_back`. Vault errors are sanitised (token-shaped
strings redacted) before they reach the API response or the UI.

The default runner is synchronous. `PROVISION_MODE=queue` leaves supported jobs pending for `src/worker.js`; a worker must actually be configured and running. Supplier deletion remains synchronous. Inspect job steps after failure: undo is best effort, and a `rolled_back` label does not guarantee every undo succeeded.

## The provisioner token

Creating a nested namespace (`suppliers/acme`) requires acting **inside** the
`suppliers` namespace, which the root-scoped `arcanium-api` AppRole token cannot
do. The provisioner therefore uses `VAULT_PROVISIONER_TOKEN`:

- **POC:** the cluster root token (in `.env`).
- **Production:** a delegated namespace-admin identity — an entity in an identity
  group that carries a `sys/namespaces/*` + `sys/mounts/*` + `auth/*` policy
  scoped to `suppliers/*`.

When `VAULT_PROVISIONER_TOKEN` is unset, provisioning still works for **root-level**
applications; supplier namespace creation fails cleanly with a rolled-back job.

## Guardrails

- The provisioner never calls `transit/encrypt|decrypt|sign`. `rewrap`
  (ciphertext-only) is the sole data-plane exception and is persona-gated.
- Every job is idempotent — re-running a completed provision is a no-op update in
  Vault.
- Inspect both execution and rollback steps. Failed undo can require operator reconciliation; partial state is possible.
