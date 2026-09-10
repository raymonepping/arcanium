# Scenario guide

Scenarios exercise real operations in the local lab. Review their source and required configuration before running them. Failure scenarios intentionally interrupt services; evidence/distribution exercises can also mutate records and cryptographic state.

| Directory | Purpose | Entry point |
| --- | --- | --- |
| `01_onboarding` | Register workloads and provision credentials | `make onboarding` |
| `03_kmip` | KMIP client credential preparation | `make kmip-provision` |
| `05_approval` | External request and approver workflow | `make approval-provision`, then inspect `approve.sh` |
| `06_supplier_isolation` | Positive, negative and list isolation matrix | `make supplier-provision`, `make supplier-test` |
| `07_failure` | Node loss, leader failover, quorum loss, seal/unseal | [Failure guide](../scenarios/07_failure/README.md) |
| `08_evidence` | Timed collection and report | `make evidence-collect` |
| `09_sentinel` | Policy enforcement and automation restrictions | `make scenario-automation-depth`; inspect individual scripts |
| `10_key_distribution` | Emulated cloud KMS distribution lifecycle | [KMS guide](../compose/kms-sim/README.md) |

## Demonstration order

1. Confirm core health and identify the actual Raft leader.
2. Show separate supplier domains and explain the Vault enforcement boundary.
3. Inspect application profiles and key custody metadata.
4. Run a chosen workload and inspect its observed result.
5. Inspect a governance request; distinguish recording a decision from native authorization.
6. Inspect evidence source and origin.
7. Review maturity basis and missing signals.
8. Run an optional failure or distribution exercise only if an interruption/destructive reset is intended.

## Acceptance evidence

Record the time, source revision, scenario, target resource, observed result and cleanup performed. Keep secret material and raw crypto payloads out of public reports. A green service probe does not establish every cryptographic lifecycle stage; a passed positive test alone does not establish negative tenant isolation.

The LocalStack distribution script can reset demonstration state. The stack verifier creates and changes resources. Read their source before using them in an environment whose existing data must be retained.
