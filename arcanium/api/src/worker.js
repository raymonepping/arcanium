// worker.js — Prompt 15.6 — arcanium-worker entrypoint.
// Drains provisioning_jobs WHERE status='pending' and executes them via
// dispatchJob(). The API enqueues; the worker runs. Same job records either way.

import { init as vaultInit, getDbCredentials } from "./vault.js";
import { init as dbInit, query } from "./db.js";
import { runMigrations } from "./migrations.js";
import { dispatchJob } from "./provisioner/dispatch.js";
import { ingestAuditLog } from "./evidence/ingest.js";

const POLL_MS = Number(process.env.WORKER_POLL_MS || 3000);
let ingestTick = 0;

async function main() {
  console.log("[worker] starting");
  await vaultInit();
  const { username, password } = getDbCredentials();
  dbInit(username, password);
  await runMigrations().catch(() => {}); // API owns migrations; tolerate a race

  console.log(`[worker] polling provisioning_jobs every ${POLL_MS}ms`);
  for (;;) {
    try {
      // Claim one pending job atomically.
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
