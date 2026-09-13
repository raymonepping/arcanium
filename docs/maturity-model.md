# Maturity model (Evidence v2 — Prompt 21)

Arcanium exposes a server-side, evidence-gated assessment at `GET /api/v1/maturity`. This replaced the earlier flat 5-dimension average (Prompt 17): averaging let `Governance = 0` still reach "Level 4" if the other four dimensions scored high — acceptable for an early demo, not acceptable once authorization (Phase 18) and reconciliation (Phase 20) started producing evidence worth trusting or not trusting precisely.

The authoritative logic is in [controls.js](../arcanium/api/src/maturity/controls.js) (the gate, the control assessors, Coverage/Confidence) and [scorer.js](../arcanium/api/src/maturity/scorer.js) (assembles the report). Treat the report as an implementation-specific assessment, not a compliance certification.

## Three separate numbers, never blended

| Metric | What it means |
| --- | --- |
| **Maturity** | A gated level, 0–5. A single *mandatory* control at `FAIL` or `UNKNOWN` caps the level regardless of how well everything else scores — see "Gating, not averaging" below. |
| **Coverage** | How much of the in-scope estate has *evidence* — `PASS` and `FAIL` both count, since a proven `FAIL` is real evidence and `UNKNOWN` (no usable evidence) is what should actually be penalized. `N/A` controls are excluded from the denominator entirely. |
| **Confidence** | How strong/fresh/direct the underlying evidence is — `HIGH` (a live read this assessment run), `MEDIUM` (reused evidence from a recent prior observation, e.g. a Phase 20 reconciliation run within its freshness window), or `LOW`. Rolled up worst-case across evidenced (`PASS`/`FAIL`) rows, never averaged into a single number. |

These are computed by [computeCoverage()](../arcanium/api/src/maturity/controls.js) and [computeConfidence()](../arcanium/api/src/maturity/controls.js) respectively.

## The four control states

Every `control_assessments` row is exactly one of:

- **`PASS`** — the control's evidence was gathered and it holds.
- **`FAIL`** — the control's evidence was gathered and it does not hold. This is real, valuable evidence, not worse than `UNKNOWN` — see the disposition note below.
- **`UNKNOWN`** — no usable evidence could be gathered this run (Vault unreachable, evidence gone stale past its TTL, a downstream read error). Never silently treated as `FAIL`, never fabricated as `PASS`.
- **`N/A`** — the control does not apply to the current scope (e.g. a tenant-isolation control when fewer than two tenants exist yet). Never scored against.

## Gating, not averaging

```js
function gatedLevel(rollup) {
  for (let level = 5; level >= 1; level--) {
    const required = MANDATORY_CONTROLS_PER_LEVEL[level];
    if (required.every(id => rollup[id] === 'PASS')) return level;
  }
  return 0;
}
```

`rollup` is a worst-case-per-control roll-up: if any per-scope assessment for a control is `FAIL`, the whole control is `FAIL`; else if any is `UNKNOWN`, the whole control is `UNKNOWN`; `N/A` rows are excluded; only if every applicable row is `PASS` does the control roll up to `PASS`. `UNKNOWN` and `N/A` both fail the `=== 'PASS'` check the same as `FAIL` does — a control nobody has exercised yet caps the level exactly like one that's actively broken.

When a level is capped, `levelCapReason` names the specific blocking control(s) — e.g. `"Level capped at 3: AUTO-01 is FAIL"` — never a bare lower number with no explanation (both the UI and CLI surface this).

## The control catalogue

| Control | Requirement | Mandatory from | Evidence source |
| --- | --- | --- | --- |
| `KEY-INV-01` | A live cryptographic key inventory exists in Vault | Level 1 | Live `vault LIST transit/keys` |
| `TEN-ISO-01` | Tenant Vault namespaces enforce a verified cross-tenant boundary | Level 2 | Live cross-tenant AppRole boundary check (Prompt 16.2) |
| `ROT-POL-01` | Production keys rotate per their declared desired-state policy | Level 3 | Phase 20 `reconciliation_runs` (latest run per key, within a 1h freshness TTL) |
| `AUD-01` | Governance actions are source- and actor-attributed | Level 3 | `approval_requests.source`/`.requester` |
| `WLI-01` | Provisioned applications hold a least-privilege workload AppRole | Level 3 | Live `vault LIST auth/approle/role`, per Vault namespace |
| `NEG-AUTHZ-01` | The hostile negative-authorization test suite last passed | Level 3 | `scenario_runs` (written by `scenarios/11_security_foundation/test_negative_auth.sh` on every run, within a 7-day freshness TTL) |
| `AUTO-01` | Rotation-from-automation is enforced by a Sentinel EGP | Level 4 | Live `vault LIST sys/policies/egp`; `N/A` if Sentinel isn't in the Vault license |
| `GOV-01` | Four-eyes governance (Control Group approval) is actively exercised | Level 5 | `approval_requests.status`/`.accessor` |
| `KML-DESTR-01` | Active keys must not exceed their declared expiry date | Not level-gated — `mandatory=true`, dimension "Key Lifecycle Hygiene" | `desired_state` rows with `requirement = 'expiry_date'` (Prompt 28) |
| `KML-OFFBOARD-01` | Decommissioned applications must have all keys destroyed within 30 days | Not level-gated — `mandatory=false`, dimension "Governance Adoption" | `applications.offboarding_initiated_at`/`.offboarded_at` (Prompt 28) |

`KML-DESTR-01` and `KML-OFFBOARD-01` follow the exact same
UNKNOWN-until-real-data discipline as every control above — neither
reports `PASS` until at least one `expiry_date` desired-state row or one
real offboarding has actually been exercised. Unlike the controls in the
table above, **neither is in `MANDATORY_CONTROLS_PER_LEVEL`** — both are
assessed and shown in the report (and `KML-DESTR-01`'s own `mandatory`
column is `true`, meaning it must eventually be addressed), but neither
one currently caps the gated 0–5 level the way `KEY-INV-01` through
`GOV-01` do. See [external-integration.md](external-integration.md) for
the workflows these two controls assess.

Every assessment is persisted as a new `control_assessments` row (an append-only evidence log, same discipline as `reconciliation_runs`) with `evidence_refs` pointing at what was actually read — a reconciliation run id, a Vault list method, a scenario run timestamp. Nothing is inferred from a database row simply existing.

## Reconciliation as evidence (Phase 20 link)

`ROT-POL-01` maps Phase 20's `reconciliation_runs.observation_status` directly: `COMPLIANT → PASS`, `DRIFTED → FAIL`, `UNKNOWN → UNKNOWN`. **`disposition` is never consulted when deriving this status** — a `DRIFTED` run with `disposition = EXCEPTION_ACCEPTED` still maps to `FAIL`, never softened to `PASS` or a third pseudo-status. The accepted exception (who, why, until when) is carried into `evidence_refs` instead, so the control record reads as "`FAIL`, exception accepted by ... until ..., reason: ..." — honest about the current state, transparent about why it's tolerated.

## Response shape

```sh
curl -fsS -b "$COOKIE" http://localhost:3001/api/v1/maturity | jq '{maturity, levelName, levelCapReason, coverage, confidence}'
```

The report includes `maturity` (and a `level` alias, kept for `scenarios/08_evidence/collect.sh`'s own compatibility), `levelName`, `levelCapReason`, `coverage`, `confidence`, `controls` (one rolled-up row per catalogue control), `dimensions` (the Prompt 17 5-dimension scores — kept as supplementary, non-gating context; they inform the UI's "signal dimensions" panel but no longer determine the level), and `checks` (a backward-compatible view of `controls` in the old ladder-check shape).

`GET /api/v1/controls` returns the latest assessment per `(control_id, scope)` pair — tenant-scoped from its first commit (a supplier-admin session never sees `estate`-scoped rows or another tenant's `ROT-POL-01` rows, verified live, not assumed from review). `GET /api/v1/controls/:id` returns one control's catalogue definition plus its per-scope assessments, same scoping.

## Proving the gate actually gates

`scenarios/14_evidence_v2/test_gated_maturity.sh` (`make scenario-evidence-v2`) is the hostile proof: forces `AUTO-01` to `FAIL` by deleting its Sentinel EGP outside Arcanium and confirms the level visibly drops with a named reason; makes Vault briefly unreachable (a real `podman network disconnect`, not a mock) and confirms the affected controls report `UNKNOWN`, not `FAIL`, not a fabricated `PASS`, and that the endpoint still responds `200`; restores both and confirms the level recovers. This test also forced a real fix in [vault.js](../arcanium/api/src/vault.js): the Vault HTTP client previously had no request timeout at all, so a network partition would hang far longer than "briefly unreachable" should reasonably take — a bounded 5s timeout was added, found necessary by this exact test, not by review.

## Improving an assessment

1. Provision at least one application through Arcanium so `KEY-INV-01` and `WLI-01` have something to observe.
2. Register at least two supplier tenants so `TEN-ISO-01` becomes applicable (fewer than two is `N/A`, not a failure).
3. Set a rotation policy at provisioning time (or via `PATCH /api/v1/reconciliation/desired-state/:id`) and let Phase 20's reconciliation loop observe it — `ROT-POL-01` reads that evidence directly.
4. Run `scenarios/11_security_foundation/test_negative_auth.sh` — it records its own pass/fail to `scenario_runs`, which `NEG-AUTHZ-01` reads back.
5. Apply the Sentinel EGP policies (`make tf-sentinel`) for `AUTO-01`.
6. Resolve at least one approval request through the real Control Group workflow for `GOV-01`.
7. Keep `UNKNOWN`/`N/A` distinct from `FAIL` when interpreting a report — a low Coverage number most often means "not yet exercised," not "broken."

Observability (Prometheus/OTel/Grafana) remains a separate, optional integration workstream — it is deployed and collecting, but its time-series signals are not folded into this assessment.
