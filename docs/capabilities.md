# Capabilities and limitations

This matrix describes source capability. Confirm actual deployment with health responses, configuration, jobs and evidence. A route existing in the repository does not prove that the running image exposes it.

| Area | Implemented source | Activation / interpretation |
| --- | --- | --- |
| UI | Standalone Nuxt application | Rebuild after source changes; API connectivity is separate |
| Registry | Suppliers, applications and crypto profiles | PostgreSQL and migrations required |
| Vault topology | Per-node health route | API needs TLS trust and Vault-internal network access |
| Supplier isolation | Namespace provisioning and isolation checks | Requires permissions and tests; a namespace name is not proof |
| Provisioning | Step jobs, synchronous and queue modes | Queue mode needs worker; rollback is best effort |
| Transit | Inventory, creation, rotation and ciphertext rewrap | Vault policies and persona gates apply |
| PKI / KMIP | Engine/configuration and workload demonstrations | Licensing, roles and client credentials required |
| Managed Keys | Optional HSM metadata/custody integration | HSM-compatible binary, license and configured identity required |
| Approvals | Governance records and decision endpoints | Database decision is not Vault-native authorization |
| Evidence | Approval-derived rows plus optional audit ingestion | Ingestion requires worker/flag/mount; origin matters |
| Maturity | Server-computed dimensions and level heuristic | Not certification; inspect formula and data quality |
| Authentication | Optional Vault userpass-backed sessions | Off by default; verify route-level authorization separately |
| Observability | Compose configuration and API adapters | Optional; integration may remain inactive |
| Cloud distribution | Key-management engine with optional LocalStack | Emulated KMS, not a live cloud account |
| Sentinel | Policy-as-code demonstrations | Entitlements and provisioner access required |

## Known boundaries

- The lab uses local bootstrap/root-of-trust material and simplified recovery settings. These are not production custody procedures.
- SoftHSM demonstrates PKCS#11 behavior using software storage. It is not a certified physical HSM.
- Authentication is optional and authorization coverage varies by route. A persona selector does not establish Vault isolation.
- Some current reads collapse unavailable data into empty arrays. Do not interpret all zero counts as verified absence.
- Supplier namespace metadata edits do not automatically migrate resources or reconcile quota configuration.
- Current evidence APIs may cap results and apply filtering to already bounded reads. UI counts can describe only the returned window.
- Governance evidence mapping and lifecycle-stage inference are summaries, not independent proof of successful cryptographic execution.
- Maturity scoring can use proxy signals and may treat unavailable checks as absent. The level is an implementation heuristic.
- Best-effort rollback and snapshot readability checks are not guaranteed transactional recovery or completed restore tests.
- Container tags, endpoint coverage and optional integrations can evolve. Read the checked-in Compose/routes and validate the deployed image before a demonstration.
