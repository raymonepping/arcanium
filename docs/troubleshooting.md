# Troubleshooting

## Vault nodes appear unhealthy while containers are up

Container state, API readiness and Vault node role are different signals. Inspect `/api/v1/cluster` and `make vault-status`. Initialized, unsealed standbys are operational; HTTP 429 from Vault health normally means standby. A sealed or unreachable node should remain visibly unhealthy.

Check TLS trust, DNS/network membership and the API's per-node health mapping if the API cannot read a node. Do not disable TLS verification to make a dashboard green.

## Topbar stays on “Connecting…”

The original cluster composable shared node data but kept its observation timestamp local to each component. The topbar could therefore remain in its initial state even while the dashboard had nodes.

Share node data, loading/error state and observation time; run polling from one persistent owner. An API failure should produce “Status unavailable,” not an indefinite connecting label or fabricated node failures.

## UI container unhealthy but the page opens

The old slim Node runtime healthcheck invoked `wget`, which is not installed in that image. The revised Containerfile and Compose probe use Node `fetch`. Rebuild/recreate the UI so both the image and service health configuration are applied.

## Rebuild appears successful but old pages remain

The old rebuild helper piped build output through `grep` and ignored some startup failures. A failed build could be followed by a restart of the previous image. Host-to-VM source visibility also caused discrepancies between source and built pages.

Use `./scripts/ui-rebuild.sh`. The revised helper streams a host archive, preserves build exit status and checks health. Compare source and image only after a successful build; never embed alternative application source inside a Containerfile as a sync workaround.

## API does not start

Read API logs and check in order: required configuration, trusted CA path, Vault reachability/unseal, AppRole validity, database role/policy, PostgreSQL availability and migrations. UI rebuilds cannot repair API credentials.

`/health/live` can pass while `/health/ready` fails. That is expected when the process runs but its dependencies are not ready.

## Supplier create/update/delete fails

- Validate the name, namespace and SLA tier.
- A duplicate name/namespace produces a conflict.
- Creation may provision a real Vault namespace; inspect its job and provisioner permissions.
- Queue mode requires a worker.
- Deletion may be blocked by linked applications, retained approval history or existing Transit keys.
- Changing a metadata namespace reference does not migrate Vault resources.

Do not force-delete a populated tenant to clear a UI error.

## Evidence sources missing or maturity unexpectedly low

Older list queries omitted `source` and `supplier_id`. Ensure the API image contains the current route source. Then inspect the actual response rather than inferring missing values from names.

Read score basis and scope. Missing audit ingestion, failed Vault probes, absent policies or unclassified applications can affect the report. A minimum decryption version does not prove automatic rotation. The number of registered applications does not prove full automation. See [maturity model](maturity-model.md).

## Empty supplier key inventory

The supplier-key route may return an empty array for Vault permission denial. Empty can therefore mean no visible keys, not proof of no keys or verified isolation. Use the tenant's authorized inspection workflow and [supplier isolation tests](../terraform/vault-suppliers/README.md).

## Optional systems unavailable

Observability requires running services, valid scrape/export configuration and traffic. Managed Key enrichment requires the HSM read identity. LocalStack KMS state can disappear on recreation. Treat each as a distinct capability failure, not a reason to mark unrelated Vault nodes down.
