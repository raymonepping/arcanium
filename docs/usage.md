# Usage

Run commands from the repository root. Complete [setup](setup.md) before using a fresh environment.

## Start and inspect

```sh
make check
make vault-up
make infra-up
make arcanium-up
make vault-status
```

Open [Arcanium](http://localhost:3000). Check the API without credentials in browser code:

```sh
curl -fsS http://localhost:3001/health/live
curl -fsS http://localhost:3001/health/ready
curl -fsS http://localhost:3001/health
```

`live` confirms the process. `ready` checks API dependencies. Per-node Vault health is at `/api/v1/cluster`; the three concepts are not interchangeable.

## Dashboard

Use the overview to inspect inventory, approval queues, supplier domains and node status. A standby node can be healthy. A data source failure should appear as unknown or unavailable; do not interpret an absent response as zero resources.

Use `⌘K` / `Ctrl+K` for page navigation. Open Vault UI separately for direct administration.

## Suppliers

Use **Create supplier** to enter a name, namespace and SLA tier. Names accept letters, numbers, underscores and hyphens. Namespace references use slash-separated segments.

The current API supports real namespace provisioning during creation. Review the returned provisioning job. Queued jobs require a running worker; an accepted request is not a completed provision.

Use **Edit supplier** to modify supported metadata. A namespace reference change is not a Vault namespace migration, and an SLA metadata edit alone does not prove a live quota changed.

Deletion is a lifecycle operation. The API checks linked applications and governance records and may refuse removal. Namespace deprovisioning is also guarded when Transit keys remain. Do not use force deletion for routine cleanup. Read the confirmation and [API semantics](api.md) before deleting a real tenant.

## Applications and keys

Applications show registry metadata and crypto profiles. Where implemented, classification distinguishes platform workloads from tenant workloads; a root platform app is not necessarily missing tenant isolation.

Key inventory distinguishes root/supplier namespaces and custody only when the API returns that metadata. A signing-capable software key is not automatically HSM-backed. Use [Managed Keys](managed-keys.md) for the separate HSM demonstration.

Provisioning, rotation, rewrap and destruction-request endpoints exist in the API. Their licensing, persona and namespace constraints still apply. Check the returned job/approval rather than assuming that clicking a button completed the action.

## Approvals and evidence

Approvals support pending/resolved inspection and decision recording. Read the drawer's distinction between an Arcanium record and Vault Control Group authorization. Resolve a demonstration request through the documented operator flow when native authorization is required:

```sh
make approval-provision
```

Then inspect [the approval script](../scenarios/05_approval/approve.sh) for its arguments and prerequisites. It performs real operations; do not run it as a read-only health check.

Approvals and evidence paginate at ten records per page in the revised UI. Filters apply before pagination. Counts describe the loaded result set; a capped API response is not the total audit history.

Evidence source is one of `manual`, `local` or `external`. Governance metadata and ingested Vault operation evidence have different origins. An approval is not proof of successful encryption, signature verification or key destruction.

## Maturity

Inspect the percentage, basis and scope together. The server maturity endpoint is:

```sh
curl -fsS http://localhost:3001/api/v1/maturity
```

A low value may reflect a missing data integration, missing configuration, an unclassified application or genuinely absent evidence. Improve the underlying control or data path; do not raise a score solely for presentation. The report is not a compliance certification.

## Optional demonstrations

| Activity | Entry point | Effect |
| --- | --- | --- |
| Workload onboarding | `make onboarding` | Registers/provisions resources and writes workload configuration |
| Workload execution | `make workloads-up` | Starts active crypto clients |
| Supplier isolation | `make supplier-test` | Exercises positive and negative access paths |
| KMIP | `make tf-kmip`, `make kmip-provision` | Configures KMIP and client credentials |
| HSM custody | `make hsm-managed-keys` | Provisions the separate Managed Key demonstration |
| Node/leader failure | [Failure scenarios](../scenarios/07_failure/README.md) | Deliberately interrupts services |
| Evidence collection | `make evidence-collect` | Runs a timed evidence exercise |
| Cloud KMS emulation | [kms-sim](../compose/kms-sim/README.md) | Starts LocalStack and exercises distribution |

Observability is a separate optional workstream. Its source and Compose files are present; enabling it is not required for core UI/API use. See [observability stack](../compose/observability/README.md).

## Rebuild and stop

```sh
./scripts/ui-rebuild.sh
# Optional: follow logs after rebuilding
./scripts/ui-rebuild.sh --logs

make workloads-down
make arcanium-down
make infra-down
make vault-down
```

Only stop stacks you intend to stop. Named volumes remain unless explicitly removed. See [operations](operations.md) for backups and recovery.
