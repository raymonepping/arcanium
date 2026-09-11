// provisioner/steps.js — Prompt 14.2
//
// A tiny step runner. Each provisioner declares an ordered list of steps; the
// runner executes them, records progress to provisioning_jobs.steps, and on
// failure runs the `undo` of every step that already succeeded (reverse order),
// marking the job `failed` or `rolled_back`.
//
// Steps handle Vault configuration only — never plaintext crypto.

import { query } from "../db.js";
import config from "../config.js";
import { JOB_STATES, assertTransition } from "../domain/state-machines.js";
import { jobEvent, observe } from "../telemetry/metrics.js";

// A same-state write (e.g. re-persisting "running" mid-loop) is not a
// transition at all — JOB_STATES has no self-loops (matching the real DB
// CHECK constraint's states, none of which re-enter themselves), so only
// check when the status is actually changing.
function setStatus(job, next) {
  if (job.status !== next) assertTransition(JOB_STATES, job.status, next);
  job.status = next;
}

/**
 * Prompt 15.6 — run the job now (sync mode) or leave it `pending` for
 * arcanium-worker (queue mode). `exec` is a function that runs the provisioner
 * given the job and returns the finished job.
 */
export async function runOrQueue(job, exec) {
  if (config.vault.provisionMode === "queue") {
    return { ...job, status: "pending", queued: true };
  }
  return exec(job);
}

export async function createJob({
  target_type,
  target_id,
  target_name,
  action,
  requested_by,
  params,
  request_id,
}) {
  const { rows } = await query(
    `INSERT INTO provisioning_jobs (target_type, target_id, target_name, action, requested_by, params, status, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING *`,
    [
      target_type,
      target_id,
      target_name ?? null,
      action,
      requested_by ?? "arcanium",
      JSON.stringify(params ?? {}),
      request_id ?? null,
    ],
  );
  return rows[0];
}

async function persist(job) {
  await query(
    `UPDATE provisioning_jobs SET status=$2, steps=$3, error=$4, updated_at=now() WHERE id=$1`,
    [job.id, job.status, JSON.stringify(job.steps), job.error ?? null],
  );
}

async function event(resource_type, resource_id, ev, detail) {
  await query(
    `INSERT INTO lifecycle_events (resource_type, resource_id, event, detail, source)
     VALUES ($1,$2,$3,$4,'local')`,
    [resource_type, resource_id, ev, detail ? JSON.stringify(detail) : null],
  ).catch(() => {});
}

/**
 * Run an ordered list of { name, run, undo? } steps for a job.
 * `run` may return a value; it is stored on the step. `undo` is best-effort.
 * Returns the final job row.
 */
export async function runSteps(job, steps) {
  // Prompt 24, Deliverable 1 — "Provision success rate" / "P95 provision
  // latency" SLOs need real outcome+duration data, not just the job row.
  // startedAt is wall-clock from the moment this job actually starts
  // running (not from job creation — a queued job's wait time is a
  // separate concern from its own execution latency).
  const startedAt = Date.now();
  setStatus(job, "running");
  job.steps = steps.map((s) => ({ step: s.name, status: "pending" }));
  await persist(job);

  const done = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    job.steps[i] = {
      step: s.name,
      status: "running",
      at: new Date().toISOString(),
    };
    await persist(job);
    try {
      const detail = await s.run();
      job.steps[i] = {
        step: s.name,
        status: "succeeded",
        detail: typeof detail === "string" ? detail : (detail ?? null),
        at: new Date().toISOString(),
      };
      done.push(s);
      await persist(job);
    } catch (err) {
      job.steps[i] = {
        step: s.name,
        status: "failed",
        detail: sanitise(err.message),
        at: new Date().toISOString(),
      };
      job.error = sanitise(err.message);
      // Roll back the steps that succeeded, newest first.
      for (let j = done.length - 1; j >= 0; j--) {
        if (typeof done[j].undo !== "function") continue;
        try {
          await done[j].undo();
          job.steps.push({
            step: `rollback: ${done[j].name}`,
            status: "succeeded",
            at: new Date().toISOString(),
          });
        } catch (e2) {
          job.steps.push({
            step: `rollback: ${done[j].name}`,
            status: "failed",
            detail: sanitise(e2.message),
            at: new Date().toISOString(),
          });
        }
      }
      setStatus(
        job,
        done.some((d) => typeof d.undo === "function")
          ? "rolled_back"
          : "failed",
      );
      await persist(job);
      await event(job.target_type, job.target_id, `${job.action}.failed`, {
        error: job.error,
      });
      jobEvent(job.action, job.status);
      observe(
        "arcanium_provision_duration_seconds",
        { action: job.action, outcome: job.status },
        (Date.now() - startedAt) / 1000,
      );
      return job;
    }
  }

  setStatus(job, "succeeded");
  await persist(job);
  await event(job.target_type, job.target_id, `${job.action}.succeeded`, null);
  jobEvent(job.action, job.status);
  observe(
    "arcanium_provision_duration_seconds",
    { action: job.action, outcome: job.status },
    (Date.now() - startedAt) / 1000,
  );
  return job;
}

// Vault errors can carry response bodies; strip anything token-shaped.
export function sanitise(msg = "") {
  return String(msg)
    .replace(/hvs\.[A-Za-z0-9._-]+/g, "hvs.***")
    .replace(/"(client_token|secret_id|token)"\s*:\s*"[^"]+"/g, '"$1":"***"')
    .slice(0, 500);
}
