// worker.js — Prompt 15.6 — arcanium-worker entrypoint.
// Drains provisioning_jobs WHERE status='pending' and executes them via
// dispatchJob(). The API enqueues; the worker runs. Same job records either way.

import { init as vaultInit, getDbCredentials } from "./vault.js";
import { init as dbInit, query } from "./db.js";
import { runMigrations } from "./migrations.js";
import { dispatchJob } from "./provisioner/dispatch.js";
import { ingestAuditLog } from "./evidence/ingest.js";
import { runSweep } from "./reconciliation/engine.js";
import { sweepOffboarding } from "./offboarding.js";
import { executeApprovedDestroys } from "./approval-execution.js";

const POLL_MS = Number(process.env.WORKER_POLL_MS || 3000);
// Prompt 20 — Deliverable 3: runs on a schedule, reusing this existing job
// loop rather than a second poller. Every ~60s by default (POLL_MS ticks),
// same "every Nth loop iteration" pattern the evidence ingest tick already
// uses just below.
const RECONCILE_EVERY_TICKS = Math.max(
  1,
  Math.round(Number(process.env.WORKER_RECONCILE_MS || 60000) / POLL_MS),
);
let ingestTick = 0;
let reconcileTick = 0;

async function main() {
  console.log("[worker] starting");
  await vaultInit();
  const { username, password } = getDbCredentials();
  dbInit(username, password);
  await runMigrations().catch(() => {}); // API owns migrations; tolerate a race

  console.log(`[worker] polling provisioning_jobs every ${POLL_MS}ms`);
  for (;;) {
    try {
      // Claim one pending job atomically. This bypasses
      // provisioner/steps.js's setStatus()/assertTransition() wrapper
      // deliberately — the SQL WHERE status='pending' clause is itself a
      // stronger, race-safe guard on the same pending→running edge
      // JOB_STATES (domain/state-machines.js) already declares legal; two
      // workers racing on the same job cannot both win this UPDATE.
      const { rows } = await query(
        `UPDATE provisioning_jobs SET status='running', updated_at=now()
         WHERE id = (
           SELECT id FROM provisioning_jobs WHERE status='pending'
           ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
      );
      // Prompt 15.3 — ingest Vault audit evidence roughly every ~15s.
      if (++ingestTick % 5 === 0) {
        try {
          const r = await ingestAuditLog();
          if (r.ingested)
            console.log(`[worker] ingested ${r.ingested} evidence rows`);
        } catch (e) {
          console.error(`[worker] evidence ingest error: ${e.message}`);
        }
      }
      // Prompt 20 — periodic reconciliation sweep, estate-wide (the worker
      // has no tenant scope of its own; per-tenant scoping only applies to
      // a human session's on-demand POST /reconciliation/run).
      if (++reconcileTick % RECONCILE_EVERY_TICKS === 0) {
        try {
          const results = await runSweep();
          const drifted = results.filter((r) => r.status === "DRIFTED").length;
          if (results.length)
            console.log(
              `[worker] reconciliation sweep: ${results.length} checked, ${drifted} drifted`,
            );
        } catch (e) {
          console.error(`[worker] reconciliation sweep error: ${e.message}`);
        }
        // Prompt 28, Deliverable 6 — same tick as the reconciliation
        // sweep: checks every in-progress offboarding for whether all its
        // destroy_request approvals have since been resolved (via the
        // normal approve/deny routes, unrelated to this tick), finalizing
        // (tombstone + offboarded_at) the ones that have. This is how an
        // approval resolved minutes or days after POST /:id/offboard
        // eventually completes the workflow without any offboarding-aware
        // logic in routes/approvals.js itself.
        try {
          const ob = await sweepOffboarding();
          if (ob.completed)
            console.log(
              `[worker] offboarding sweep: ${ob.checked} in progress, ${ob.completed} completed`,
            );
        } catch (e) {
          console.error(`[worker] offboarding sweep error: ${e.message}`);
        }
        // Prompt 29, Deliverable 6 — same tick: an approved destroy_request
        // does not execute itself (see approval-execution.js's own header
        // for why this step was missing entirely before). Runs after the
        // offboarding sweep so a request approved as part of offboarding
        // still gets picked up the same tick it was resolved.
        try {
          const ex = await executeApprovedDestroys();
          if (ex.executed || ex.failed || ex.skipped)
            console.log(
              `[worker] approval execution: ${ex.checked} approved pending, ${ex.executed} destroyed, ${ex.skipped} skipped (no live trigger), ${ex.failed} failed (will retry)`,
            );
        } catch (e) {
          console.error(`[worker] approval execution error: ${e.message}`);
        }
      }

      if (!rows.length) {
        await sleep(POLL_MS);
        continue;
      }
      const job = rows[0];
      console.log(
        `[worker] job ${job.id.slice(0, 8)} ${job.action} ${job.target_type}/${job.target_name}`,
      );
      try {
        const done = await dispatchJob(job);
        console.log(`[worker]   → ${done.status}`);
      } catch (err) {
        console.error(`[worker]   → error: ${err.message}`);
        // running -> failed — legal per JOB_STATES; this job was just
        // claimed into 'running' above, so no other prior state is reachable.
        await query(
          `UPDATE provisioning_jobs SET status='failed', error=$2, updated_at=now() WHERE id=$1`,
          [job.id, String(err.message).slice(0, 500)],
        ).catch(() => {});
      }
    } catch (loopErr) {
      console.error(`[worker] loop error: ${loopErr.message}`);
      await sleep(POLL_MS * 2);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error("[worker] fatal:", err.message);
  process.exit(1);
});
