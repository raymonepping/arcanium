// domain/state-machines.js — Prompt 22, Deliverable 3.
//
// Status strings become explicit state machines with defined legal
// transitions — illegal transitions must be provably unreachable, not just
// avoided by convention (input/32). assertTransition() is wired into every
// place a job/reconciliation row's status is written
// (provisioner/steps.js, reconciliation/engine.js) so an illegal write
// throws immediately, at the write site, not discovered later from a
// corrupted row.

// ── Provisioning jobs ────────────────────────────────────────────────────
// JOB_STATES matches provisioning_jobs' real CHECK constraint
// (migrations/005_provisioning.sql: 'pending','running','succeeded',
// 'failed','rolled_back' — five states, not six) and how runSteps()
// actually writes status: rollback is synchronous and all-or-nothing
// within one runSteps() call — this codebase never persists an
// intermediate "rolling back right now" row between requests, so there is
// no separate ROLLING_BACK/ROLLBACK_FAILED state to model. An earlier
// draft of this file modeled six states matching this prompt's own
// illustrative snippet; corrected to match the real schema and code
// before shipping — capture current behavior, not a speculative redesign
// (Deliverable 1's own rule, applied here too).
export const JOB_STATES = {
  pending: ["running"],
  running: ["succeeded", "failed", "rolled_back"],
  succeeded: [],
  failed: [],
  rolled_back: [],
};

// ── Reconciliation (Prompt 20) ───────────────────────────────────────────
// input/36 correction: observation_status and disposition are two
// INDEPENDENT state machines, not one merged enum. An accepted exception
// does not change what was actually observed — it changes how Arcanium
// treats that observation. Do not reintroduce a single combined
// COMPLIANT/DRIFTED/UNKNOWN/EXCEPTION_ACCEPTED enum here; that was an
// earlier draft mistake this prompt corrects (see Deliverable 4's
// EXCEPTION_ACCEPTED-in-status regression guard).
export const OBSERVATION_STATUS_STATES = {
  COMPLIANT: ["DRIFTED", "UNKNOWN"],
  DRIFTED: ["COMPLIANT", "UNKNOWN"],
  UNKNOWN: ["COMPLIANT", "DRIFTED"],
};

export const DISPOSITION_STATES = {
  OPEN: ["EXCEPTION_ACCEPTED", "RECONCILED"],
  EXCEPTION_ACCEPTED: ["OPEN", "RECONCILED"], // OPEN = expiry lapsed or run re-drifted
  RECONCILED: ["OPEN"], // a later run can re-drift, reopening it
};

/**
 * Throws if `from -> to` is not a legal transition in `machine`. A `from`
 * of `null`/`undefined` (the row's very first status — no prior value to
 * transition from) is always allowed, since every machine's initial state
 * is reached by creation, not a transition.
 */
export function assertTransition(machine, from, to) {
  if (from == null) return; // initial write — nothing to transition from
  if (!machine[from]?.includes(to)) {
    throw new Error(`illegal transition ${from} → ${to}`);
  }
}
