// maturity/scorer.js — assembles the five maturity dimensions + the level ladder
// into a single server-computed report. This is the authoritative maturity score;
// the UI renders it and does no scoring of its own.

import {
  dimKeyLifecycle,
  dimAccessControl,
  dimGovernance,
  dimAuditTrail,
  dimAutomation,
  ladderChecks,
} from "./checks.js";

// Level names from docs/maturity-model.md / Prompt 12.
const LEVEL_NAMES = {
  0: "Unaware",
  1: "Reactive",
  2: "Defined",
  3: "Managed",
  4: "Optimised",
  5: "Governed",
};

function levelFrom(overall) {
  return Math.max(0, Math.min(5, Math.floor(overall / 18)));
}

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
  const checks = await ladderChecks().catch(() => []);

  const dimensions = dims.map((d) => ({ ...d, cls: cls(d.score) }));
  const overall = Math.round(
    dimensions.reduce((a, d) => a + d.score, 0) / dimensions.length,
  );
  const level = levelFrom(overall);

  return {
    overall,
    level,
    levelName: LEVEL_NAMES[level],
    dimensions,
    checks,
    // Kept for backward compatibility with scenarios/08_evidence/collect.sh.
    score: checks.filter((c) => c.passed).length,
    maxScore: checks.length,
    percentage: overall,
    generatedAt: new Date().toISOString(),
    evaluatedAt: new Date().toISOString(),
  };
}
