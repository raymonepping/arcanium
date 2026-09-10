# Maturity model

Arcanium exposes a server-side assessment at `GET /api/v1/maturity`. The report combines five weighted dimensions, explanatory basis strings, next steps and diagnostic checks. Treat it as an implementation-specific demonstration score, not a compliance certification.

The authoritative formulas are in [checks.js](../arcanium/api/src/maturity/checks.js) and [scorer.js](../arcanium/api/src/maturity/scorer.js). Historical UI percentages were computed from incomplete list responses and should not be compared as if they used the same model.

## Server dimensions

| Dimension | Current weighting | Interpretation |
| --- | --- | --- |
| Key Lifecycle Hygiene | 45% non-exportable, 30% deletion-protected, 25% minimum decryption version ≥ 1 | Custody/version policy signals. Automatic rotation is reported as a recommendation; minimum version is not an automatic rotation policy. |
| Access Control Coverage | 25 points for supplier presence, 50% classified apps, 25% non-platform tenant classification | Platform workloads can intentionally remain in root. Classification and registration are not live ACL verification. |
| Governance Adoption | 45% accessor presence, 25% resolved requests, up to 10 points for request count, 20 for any Sentinel EGP | Accessor strings and policy presence are proxy signals, not proof of successful native authorization. |
| Audit Trail Completeness | 35% source presence, 25% requester presence, 25% accessor presence, up to 15 points for three ingested operation types | Covers available governance/audit metadata, not an independently verified total history. |
| Automation Depth | Namespace registration 20, app registration 15, approval pipeline 15, auto-rotation presence 15, succeeded jobs 15, named automation EGP presence 20 | Measures selected configuration/usage signals. Some are presence checks rather than runtime effectiveness tests. |

Counts and ratios are bounded and rounded by the implementation. Audit ingestion requires `EVIDENCE_INGEST_ENABLED`, readable audit input and a running worker.

## Overall and level

The current server calculates the arithmetic mean of the five dimension scores, rounded to an integer. It derives the level as:

```text
overall = round(mean(dimension scores))
level   = clamp(floor(overall / 18), 0, 5)
```

| Level | Label | Current score band |
| --- | --- | --- |
| 0 | Unaware | 0–17 |
| 1 | Reactive | 18–35 |
| 2 | Defined | 36–53 |
| 3 | Managed | 54–71 |
| 4 | Optimised | 72–89 |
| 5 | Governed | 90–100 |

The diagnostic ladder checks currently do **not** gate the level. The older description saying every lower-level check must pass was inaccurate for this implementation.

## Response

The report includes `overall`, `level`, `levelName`, `dimensions`, `checks`, `generatedAt` and compatibility fields `score`, `maxScore`, `percentage`, `evaluatedAt`.

```sh
curl -fsS http://localhost:3001/api/v1/maturity
```

Inspect each dimension's `basis` and `nextStep`. Avoid publishing a fixed expected level: inventory, evidence, entitlements and policy configuration differ between environments.

## Data-quality limits

The implementation currently catches some database/Vault read failures and treats them as empty data. A low score can therefore represent unavailable measurement rather than a confirmed missing control.

Some ladder checks are weaker than their labels imply:

- “Key inventory exists” currently tests registered applications.
- “Tenant namespaces provisioned” counts supplier records.
- “Four-eyes approval exercised” checks for a resolved database request.
- The current source-attribution ladder check passes when any approval exists; it does not independently inspect source/actor fields.

These limitations must remain visible when interpreting a report. The five dimensions and the diagnostic checks should not be advertised as audited control effectiveness.

## Improving an assessment

1. Repair missing API fields or failed measurement paths before changing scores.
2. Classify platform and tenant apps intentionally; do not bind root platform workloads to arbitrary tenants just to increase a percentage.
3. Apply required policies and verify their behavior with authorized positive/negative tests.
4. Configure rotation and observe an actual rotation where required.
5. Resolve intended governance requests through the correct Vault and Arcanium workflows.
6. Connect workload audit ingestion and inspect evidence origin, attribution and coverage.
7. Keep unknown/unavailable measurements distinct from successful checks.

Observability remains an optional integration workstream. Do not claim a complete telemetry-backed assessment merely because the report endpoint responds.
