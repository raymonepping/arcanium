# Scale readiness

Honest per-question assessment of Arcanium's current architecture against
input/32's scale questions, marked **built**, **supported by design but
not exercised**, or **not yet addressed** — never a fabricated HA claim.
Prompt 24's own Non-goals section already says this deliverable is
explicitly allowed to report gaps rather than close them; this document
does that, with specifics from reading the actual code, not guesses.

| Question | Status |
| --- | --- |
| 2 API instances? | **supported by design, not exercised** — see below |
| multiple workers? | **partially built** — job dispatch is safe; the worker's other periodic ticks are not |
| PostgreSQL HA? | **not yet addressed** |
| job locking? | **built** — see below |
| duplicate workers? | **partially built** — same nuance as "multiple workers" above |
| leader election? | **not yet addressed** |
| distributed reconciliation? | **not yet addressed** |
| rate limits / backpressure? | **not yet addressed** on the Arcanium API itself; a related, narrower thing IS built for tenant Vault access — see below |

## 2 API instances?

**Supported by design, not exercised.** `arcanium-api` itself is
stateless in the way that matters for horizontal scaling: sessions are
Keycloak-issued and validated per-request (no server-side session store
tied to one process), and all durable state lives in Postgres/Vault, not
in-memory. Nothing in `compose/arcanium/compose.yaml` currently runs more
than one `arcanium-api` replica, and no load balancer sits in front of
it — this has never actually been run with 2 instances.

One concrete gap a second instance would hit today, found while writing
this document: `arcanium/api/src/telemetry/slo.js`'s
`vault_dependency_health` SLO is fed by an in-process poller
(`startVaultHealthPoll`, started once per process in `index.js`) that
keeps its samples in a module-level ring buffer. With 2 API instances,
each would poll independently and hold its own, incomplete set of
samples — a request answered by instance A would report a different
`vault_dependency_health` sample count/value than one answered by
instance B, with no shared state between them. Every other SLO in
Deliverable 1 reads from Prometheus or Postgres (shared, instance-
independent sources), so only this one SLO has this problem. Fixing it
(a shared store, or moving the poll to a single designated process) is
not done in this phase — it is exactly the kind of thing "supported by
design but not exercised" is for.

## Multiple workers / duplicate workers / job locking

**Job locking is genuinely built**, not aspirational:
`arcanium/api/src/worker.js` claims a job with

```sql
UPDATE provisioning_jobs SET status='running', updated_at=now()
WHERE id = (
  SELECT id FROM provisioning_jobs WHERE status='pending'
  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
)
RETURNING *
```

`FOR UPDATE SKIP LOCKED` means two `arcanium-worker` instances racing on
the same poll tick genuinely cannot both claim the same job — this part
of "multiple workers" is real, verified by reading the actual query, not
assumed from the presence of a worker process.

Evidence ingestion (the same worker's `ingestAuditLog()` tick) has a
partial safety net: inserted evidence rows carry a `dedupe_key` with `ON
CONFLICT (dedupe_key) DO NOTHING`, so a duplicate ingestion attempt does
not create duplicate evidence rows. But the read-offset it advances
(`ON CONFLICT (path) DO UPDATE SET offset_bytes = ...`) is not read-then-
advanced atomically across two concurrent workers — two workers racing
on the same audit log file could each read from a stale offset and then
overwrite each other's advance. This has not been exercised with more
than one worker instance.

**Reconciliation sweeps are the real, unaddressed gap.** The same
worker's periodic sweep (`runSweep()`, `arcanium/api/src/reconciliation/
engine.js`) runs on each worker's own local tick counter
(`reconcileTick % RECONCILE_EVERY_TICKS`), with no advisory lock, no
leader check, and no dedup on the `reconciliation_runs` rows it writes.
Two `arcanium-worker` instances would each independently run full sweeps
on their own schedule, doubling (or worse, overlapping) the work and the
recorded runs. This is the concrete reason "distributed reconciliation"
below is marked not yet addressed, and it is a direct, specific
consequence of reading `worker.js`, not a generic disclaimer.

So: **the part of "job locking" that matters most (provisioning work
itself) is built and safe. The periodic, non-job-queue background work in
the same process (evidence ingest offset-advance, reconciliation sweeps)
is not** — running more than one `arcanium-worker` today would be safe
for provisioning jobs and unsafe (duplicated work, no correctness
violation but wasted/racy writes) for the rest.

## PostgreSQL HA

**Not yet addressed.** `compose/infra/compose.yaml` runs a single
`postgres:16-alpine` container with one named volume — no replication,
no standby, no connection-pooler/failover layer. Deliverable
7's Drill B (`scenarios/15_operability/test_postgres_recovery.sh`) proves
Postgres can be *recovered* after total loss (destroy → recreate →
restore → migrate → verify, with measured RTO/RPO) — that is disaster
recovery, not high availability. Recovery and HA are different
guarantees; this repo has the former, not the latter.

## Leader election

**Not yet addressed.** No component in this repo elects a leader among
its own peers. (Vault's own Raft leader election, used by the vault-1/2/3
cluster internally, is HashiCorp's implementation inside Vault itself —
not something Arcanium built or would need to replicate for its own API/
worker processes.)

## Distributed reconciliation

**Not yet addressed** — see the reconciliation-sweep gap described above
under "multiple workers." Running the sweep safely across multiple
worker instances would need either an advisory lock
(`pg_try_advisory_lock`) around `runSweep()`, or moving the sweep out of
the worker's per-instance tick loop into something with a single owner.
Neither exists yet.

## Rate limits / backpressure

**Not yet addressed on the Arcanium API itself** — no
`express-rate-limit` (or equivalent) middleware exists anywhere in
`arcanium/api/src`, and nothing in `securityHeaders`/`requireSession`
throttles request volume. A slow or hostile client can send requests as
fast as the process (and Postgres/Vault behind it) can absorb them.

One related, narrower thing IS built, and is worth distinguishing from
the above rather than folding into one blanket "no": tenant onboarding
(`arcanium/api/src/provisioner/supplier.js`) provisions a Vault-side
`sys/quotas/rate-limit/<tenant>-sla` quota per supplier. That protects
Vault from a single tenant's workload traffic — it has nothing to do with
protecting Arcanium's own API from request volume, which remains
unaddressed.

## Non-goals reminder

Per this prompt's own Non-goals: this document is not a plan to close
these gaps in this phase, and none of Deliverables 1-5/7/8 attempt
partial HA and call it done. Everything above marked "not yet addressed"
is exactly that — addressed in a later phase, if and when it's prioritized.
