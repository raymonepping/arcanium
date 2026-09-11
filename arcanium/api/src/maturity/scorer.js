// maturity/scorer.js — Prompt 21: Evidence Model v2.
//
// Replaces the flat 5-dimension average with a gated level derived from
// real control evidence (maturity/controls.js) — see that file's header
// for the full rationale. This is the authoritative maturity report; the
// UI renders it and does no scoring of its own.
//
// The 5 dimension scores (checks.js, Prompt 17) are kept as supplementary,
// non-gating context per this phase's own Non-goals ("not replacing
// Prompt 17's existing 5-dimension categories outright... does not
// redesign what the dimensions measure") — they inform `dimensions[]`
// only; they no longer determine `level`/`maturity`.

import {
  dimKeyLifecycle,
  dimAccessControl,
  dimGovernance,
  dimAuditTrail,
  dimAutomation,
} from "./checks.js";
import {
  runControlAssessment,
  rollupByControl,
  gatedLevel,
  levelCapReason,
  computeCoverage,
  computeConfidence,
  MANDATORY_CONTROLS_PER_LEVEL,
} from "./controls.js";
import { query } from "../db.js";

// Level names from docs/maturity-model.md / Prompt 12.
const LEVEL_NAMES = {
  0: "Unaware",
  1: "Reactive",
  2: "Defined",
  3: "Managed",
  4: "Optimised",
  5: "Governed",
};

function cls(score) {
  if (score === 0) return "none";
  if (score < 45) return "low";
  if (score < 75) return "mid";
  return "high";
}

export async function computeMaturity() {
  const dims = await Promise.all([
    dimKeyLifecycle(),
    dimAccessControl(),
    dimGovernance(),
    dimAuditTrail(),
    dimAutomation(),
  ]);
  const dimensions = dims.map((d) => ({ ...d, cls: cls(d.score) }));

  const assessments = await runControlAssessment();
  const rollup = rollupByControl(assessments);
  const level = gatedLevel(rollup);
  const coverage = computeCoverage(assessments);
  const confidence = computeConfidence(assessments);
  const capReason = levelCapReason(rollup, level);

  const { rows: catalogue } = await query(
    "SELECT id, requirement, mandatory, dimension FROM controls ORDER BY id",
  );
  const controls = catalogue.map((c) => ({
    ...c,
    status: rollup[c.id] ?? "UNKNOWN",
  }));

  // Backward-compat shape for scenarios/08_evidence/collect.sh, which reads
  // .level/.levelName/.score/.percentage/.checks[]. Real values now, not a
  // separately-averaged number — a client that only ever read these fields
  // keeps working and now sees the actual gate.
  const checks = controls.map((c) => ({
    id: c.id,
    name: c.requirement,
    level:
      Object.entries(MANDATORY_CONTROLS_PER_LEVEL).find(([, ids]) =>
        ids.includes(c.id),
      )?.[0] ?? null,
    passed: c.status === "PASS",
    evidence: `${c.status} — ${c.dimension}`,
  }));

  return {
    maturity: level,
    level, // alias — see backward-compat note above
    levelName: LEVEL_NAMES[level],
    levelCapReason: capReason,
    coverage,
    confidence,
    controls,
    dimensions,
    checks,
    // Kept for backward compatibility with scenarios/08_evidence/collect.sh.
    score: controls.filter((c) => c.status === "PASS").length,
    maxScore: controls.length,
    percentage: coverage,
    generatedAt: new Date().toISOString(),
    evaluatedAt: new Date().toISOString(),
  };
}
