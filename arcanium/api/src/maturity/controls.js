// maturity/controls.js — Prompt 21: Evidence Model v2.
//
// Assesses the 8 seeded controls (013_controls.sql) against real evidence —
// a live Vault read, a Prompt 20 reconciliation run, a Sentinel EGP list, a
// recorded hostile-scenario result — and persists every assessment as a new
// control_assessments row (an append-only evidence log, same discipline as
// Prompt 20's reconciliation_runs). GET /api/v1/maturity and
// GET /api/v1/controls read these rows back; nothing here is inferred from
// the mere existence of a database row (input/03 §8, input/32).
//
// UNKNOWN is a first-class terminal status, never softened to FAIL or
// fabricated as PASS. N/A means "does not apply to this scope" — also never
// scored against.

import { query } from "../db.js";
import {
  listTransitKeys,
  vaultRequest,
  vaultRequestNs,
  getProvisionerToken,
} from "../vault.js";
import { checkIsolation } from "../suppliers/isolation.js";
import { readFeatures } from "../routes/platform.js";

// Evidence older than this is not "this run's" observation — Design rule:
// "anything beyond the cache TTL ... is UNKNOWN status, not a LOW-confidence
// PASS." Reconciliation sweeps every ~60s (Prompt 20 worker tick); an hour
// of staleness means something is actually wrong, not just unlucky timing.
const ROT_POL_TTL_MS = 60 * 60 * 1000;
// The negative-auth suite is a human/CI-triggered scenario, not a
// continuously-scheduled one in this reference deployment — a week is
// "recent enough to still mean something" without demanding it be re-run
// every session.
const NEG_AUTHZ_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function freshnessSeconds(observedAt) {
  return Math.max(
    0,
    Math.round((Date.now() - new Date(observedAt).getTime()) / 1000),
  );
}

async function sentinelEgpNames() {
  try {
    const r = await vaultRequest(
      "LIST",
      "sys/policies/egp",
      null,
      getProvisionerToken(),
    );
    return r?.data?.keys ?? [];
  } catch {
    return [];
  }
}

function assessment({
  control_id,
  scope,
  status,
  desired_value = null,
  observed_value = null,
  evidence_refs = {},
  freshness_seconds = 0,
  confidence,
}) {
  return {
    control_id,
    scope,
    status,
    desired_value,
    observed_value,
    evidence_refs,
    freshness_seconds,
    confidence,
  };
}

// ── KEY-INV-01 — a live cryptographic key inventory exists ─────────────────
async function assessKeyInventory() {
  try {
    const names = await listTransitKeys();
    return [
      assessment({
        control_id: "KEY-INV-01",
        scope: "estate",
        status: names.length > 0 ? "PASS" : "FAIL",
        observed_value: { key_count: names.length },
        evidence_refs: { method: "vault LIST transit/keys" },
        confidence: "HIGH",
      }),
    ];
  } catch (err) {
    return [
      assessment({
        control_id: "KEY-INV-01",
        scope: "estate",
        status: "UNKNOWN",
        evidence_refs: { error: err.message },
        confidence: "HIGH",
      }),
    ];
  }
}

// ── TEN-ISO-01 — verified cross-tenant boundary ─────────────────────────────
async function assessTenantIsolation() {
  const iso = await checkIsolation();
  let status;
  if (iso.tenants.length < 2) {
    status = "N/A"; // Design rule: not applicable, never scored against.
  } else if (iso.note && /Could not run/.test(iso.note)) {
    status = "UNKNOWN";
  } else {
    status = iso.verified ? "PASS" : "FAIL";
  }
  return [
    assessment({
      control_id: "TEN-ISO-01",
      scope: "estate",
      status,
      observed_value: { verified: iso.verified, tenants: iso.tenants },
      evidence_refs: {
        method: "live cross-tenant AppRole boundary check",
        checked_at: iso.checked_at,
        note: iso.note,
      },
      freshness_seconds: freshnessSeconds(iso.checked_at),
      confidence: "HIGH",
    }),
  ];
}

// ── ROT-POL-01 — rotation policy reconciled (Prompt 20 as evidence) ────────
async function assessRotationPolicy() {
  const { rows } = await query(
    `SELECT ds.id, ds.application_id, a.name AS app_name, a.supplier_id,
            s.vault_namespace, ds.key_name, ds.desired_value,
            lr.id AS run_id, lr.status, lr.observed_value, lr.observed_at
       FROM desired_state ds
       JOIN applications a ON a.id = ds.application_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       LEFT JOIN LATERAL (
         SELECT * FROM reconciliation_runs r
          WHERE r.desired_state_id = ds.id
          ORDER BY r.observed_at DESC LIMIT 1
       ) lr ON true
      WHERE ds.requirement = 'rotation_period'`,
  );

  if (!rows.length) {
    return [
      assessment({
        control_id: "ROT-POL-01",
        scope: "estate",
        status: "UNKNOWN",
        evidence_refs: {
          detail: "no rotation-period desired state configured yet",
        },
        confidence: "HIGH",
      }),
    ];
  }

  return rows.map((r) => {
    const scope = `${r.vault_namespace ?? "root"}/${r.app_name}/${r.key_name}`;
    if (!r.run_id) {
      return assessment({
        control_id: "ROT-POL-01",
        scope,
        status: "UNKNOWN",
        desired_value: r.desired_value,
        evidence_refs: { desired_state_id: r.id, detail: "never reconciled" },
        confidence: "HIGH",
      });
    }
    const stale =
      Date.now() - new Date(r.observed_at).getTime() > ROT_POL_TTL_MS;
    const status = stale
      ? "UNKNOWN"
      : r.status === "COMPLIANT"
        ? "PASS"
        : r.status === "DRIFTED"
          ? "FAIL"
          : "UNKNOWN";
    return assessment({
      control_id: "ROT-POL-01",
      scope,
      status,
      desired_value: r.desired_value,
      observed_value: r.observed_value,
      evidence_refs: {
        reconciliation_run_id: r.run_id,
        desired_state_id: r.id,
        stale: stale || undefined,
      },
      freshness_seconds: freshnessSeconds(r.observed_at),
      // Reused evidence from a prior reconciliation run, not a fresh read
      // this assessment run — Design rule: MEDIUM, not HIGH.
      confidence: status === "UNKNOWN" ? "HIGH" : "MEDIUM",
    });
  });
}

// ── KML-DESTR-01 — active keys must not exceed their declared expiry date ──
// Prompt 28, Deliverable 7. Same structure as assessRotationPolicy() above,
// for requirement='expiry_date' instead of 'rotation_period' — UNKNOWN
// estate-wide until any application actually sets an expiry policy, never
// fabricated PASS just because the control exists in the catalogue.
async function assessKeyExpiry() {
  const { rows } = await query(
    `SELECT ds.id, ds.application_id, a.name AS app_name, a.supplier_id,
            s.vault_namespace, ds.key_name, ds.desired_value,
            lr.id AS run_id, lr.status, lr.observed_value, lr.observed_at
       FROM desired_state ds
       JOIN applications a ON a.id = ds.application_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       LEFT JOIN LATERAL (
         SELECT * FROM reconciliation_runs r
          WHERE r.desired_state_id = ds.id
          ORDER BY r.observed_at DESC LIMIT 1
       ) lr ON true
      WHERE ds.requirement = 'expiry_date' AND ds.archived_at IS NULL`,
  );

  if (!rows.length) {
    return [
      assessment({
        control_id: "KML-DESTR-01",
        scope: "estate",
        status: "UNKNOWN",
        evidence_refs: {
          detail: "no expiry-date desired state configured yet",
        },
        confidence: "HIGH",
      }),
    ];
  }

  return rows.map((r) => {
    const scope = `${r.vault_namespace ?? "root"}/${r.app_name}/${r.key_name}`;
    if (!r.run_id) {
      return assessment({
        control_id: "KML-DESTR-01",
        scope,
        status: "UNKNOWN",
        desired_value: r.desired_value,
        evidence_refs: { desired_state_id: r.id, detail: "never reconciled" },
        confidence: "HIGH",
      });
    }
    const stale =
      Date.now() - new Date(r.observed_at).getTime() > ROT_POL_TTL_MS;
    const status = stale
      ? "UNKNOWN"
      : r.status === "COMPLIANT"
        ? "PASS"
        : r.status === "DRIFTED"
          ? "FAIL"
          : "UNKNOWN";
    return assessment({
      control_id: "KML-DESTR-01",
      scope,
      status,
      desired_value: r.desired_value,
      observed_value: r.observed_value,
      evidence_refs: {
        reconciliation_run_id: r.run_id,
        desired_state_id: r.id,
        stale: stale || undefined,
      },
      freshness_seconds: freshnessSeconds(r.observed_at),
      confidence: status === "UNKNOWN" ? "HIGH" : "MEDIUM",
    });
  });
}

const OFFBOARD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// ── KML-OFFBOARD-01 — decommissioned applications must have all keys
// destroyed within 30 days ─────────────────────────────────────────────
// Prompt 28, Deliverable 7. Non-mandatory (governance adoption, not a hard
// gate) — UNKNOWN estate-wide until any application has actually gone
// through offboarding.
async function assessOffboarding() {
  const { rows } = await query(
    `SELECT id, name, supplier_id, offboarding_initiated_at, offboarded_at
       FROM applications WHERE offboarding_initiated_at IS NOT NULL`,
  );
  if (!rows.length) {
    return [
      assessment({
        control_id: "KML-OFFBOARD-01",
        scope: "estate",
        status: "UNKNOWN",
        evidence_refs: { detail: "no application has been offboarded yet" },
        confidence: "HIGH",
      }),
    ];
  }
  return rows.map((r) => {
    const scope = `applications/${r.name}`;
    const elapsedMs =
      (r.offboarded_at ? new Date(r.offboarded_at) : new Date()) -
      new Date(r.offboarding_initiated_at);
    if (!r.offboarded_at) {
      // Still in progress — only a genuine FAIL if it's overrun the
      // window without completing; otherwise honestly still UNKNOWN
      // (not yet resolved either way), never a premature PASS.
      const status = elapsedMs > OFFBOARD_WINDOW_MS ? "FAIL" : "UNKNOWN";
      return assessment({
        control_id: "KML-OFFBOARD-01",
        scope,
        status,
        evidence_refs: {
          application_id: r.id,
          offboarding_initiated_at: r.offboarding_initiated_at,
          detail: "offboarding still in progress",
        },
        confidence: "HIGH",
      });
    }
    return assessment({
      control_id: "KML-OFFBOARD-01",
      scope,
      status: elapsedMs <= OFFBOARD_WINDOW_MS ? "PASS" : "FAIL",
      evidence_refs: {
        application_id: r.id,
        offboarding_initiated_at: r.offboarding_initiated_at,
        offboarded_at: r.offboarded_at,
        elapsed_days: Math.round(elapsedMs / 86400000),
      },
      freshness_seconds: freshnessSeconds(r.offboarded_at),
      confidence: "HIGH",
    });
  });
}

// ── AUD-01 — governance actions are source/actor-attributed ────────────────
async function assessAuditTrail() {
  const { rows } = await query(
    "SELECT source, requester FROM approval_requests",
  );
  if (!rows.length) {
    return [
      assessment({
        control_id: "AUD-01",
        scope: "estate",
        status: "UNKNOWN",
        evidence_refs: { detail: "no approval_requests recorded yet" },
        confidence: "HIGH",
      }),
    ];
  }
  const attributed = rows.filter((r) => r.source && r.requester).length;
  return [
    assessment({
      control_id: "AUD-01",
      scope: "estate",
      status: attributed === rows.length ? "PASS" : "FAIL",
      observed_value: { attributed, total: rows.length },
      evidence_refs: { method: "approval_requests.source/requester non-null" },
      confidence: "HIGH",
    }),
  ];
}

// ── WLI-01 — provisioned applications hold a least-privilege AppRole ───────
// Found live, not by review: a tenant-bound application's AppRole role lives
// in ITS OWN Vault namespace (provisionApplication creates it there via
// vaultRequestNs — provisioner/application.js), not the root namespace.
// Listing only "auth/approle/role" (root) produced a false FAIL for every
// tenant application on first run — fixed by listing per-namespace, the same
// way provisionApplication itself writes per-namespace.
async function assessWorkloadIdentity() {
  const { rows: apps } = await query(
    `SELECT DISTINCT a.name, s.vault_namespace
       FROM applications a
       JOIN crypto_profiles cp ON cp.application_id = a.id AND cp.type = 'transit'
       LEFT JOIN suppliers s ON s.id = a.supplier_id`,
  );
  if (!apps.length) {
    return [
      assessment({
        control_id: "WLI-01",
        scope: "estate",
        status: "UNKNOWN",
        evidence_refs: { detail: "no provisioned applications yet" },
        confidence: "HIGH",
      }),
    ];
  }

  const byNamespace = new Map(); // namespace (or null=root) -> app names
  for (const a of apps) {
    const ns = a.vault_namespace ?? null;
    if (!byNamespace.has(ns)) byNamespace.set(ns, []);
    byNamespace.get(ns).push(a.name);
  }

  const missing = [];
  let readError = null;
  for (const [ns, names] of byNamespace) {
    try {
      const r = ns
        ? await vaultRequestNs(
            "LIST",
            "auth/approle/role",
            null,
            getProvisionerToken(),
            ns,
          )
        : await vaultRequest(
            "LIST",
            "auth/approle/role",
            null,
            getProvisionerToken(),
          );
      const roles = new Set(r?.data?.keys ?? []);
      for (const name of names) {
        if (!roles.has(`${name}-workload`))
          missing.push(`${name} (ns=${ns ?? "root"})`);
      }
    } catch (err) {
      if (err.vaultStatus === 404) {
        // Empty approle mount in this namespace — every app in it is missing.
        for (const name of names) missing.push(`${name} (ns=${ns ?? "root"})`);
      } else {
        readError = err;
      }
    }
  }

  if (readError) {
    return [
      assessment({
        control_id: "WLI-01",
        scope: "estate",
        status: "UNKNOWN",
        evidence_refs: { error: readError.message },
        confidence: "HIGH",
      }),
    ];
  }

  return [
    assessment({
      control_id: "WLI-01",
      scope: "estate",
      status: missing.length === 0 ? "PASS" : "FAIL",
      observed_value: { provisioned: apps.length, missing_approle: missing },
      evidence_refs: {
        method: "vault LIST auth/approle/role, per Vault namespace",
      },
      confidence: "HIGH",
    }),
  ];
}

// ── NEG-AUTHZ-01 — hostile negative-auth suite last passed ─────────────────
async function assessNegativeAuthz() {
  const { rows } = await query(
    `SELECT passed, failed, unknown, ran_at FROM scenario_runs
      WHERE scenario = '11_security_foundation'
      ORDER BY ran_at DESC LIMIT 1`,
  );
  if (!rows.length) {
    return [
      assessment({
        control_id: "NEG-AUTHZ-01",
        scope: "estate",
        status: "UNKNOWN",
        evidence_refs: {
          detail: "scenarios/11_security_foundation has never recorded a run",
        },
        confidence: "HIGH",
      }),
    ];
  }
  const last = rows[0];
  const stale = Date.now() - new Date(last.ran_at).getTime() > NEG_AUTHZ_TTL_MS;
  const status = stale ? "UNKNOWN" : last.failed === 0 ? "PASS" : "FAIL";
  return [
    assessment({
      control_id: "NEG-AUTHZ-01",
      scope: "estate",
      status,
      observed_value: {
        passed: last.passed,
        failed: last.failed,
        unknown: last.unknown,
      },
      evidence_refs: {
        scenario: "11_security_foundation",
        ran_at: last.ran_at,
        stale: stale || undefined,
      },
      freshness_seconds: freshnessSeconds(last.ran_at),
      confidence: status === "UNKNOWN" ? "HIGH" : "MEDIUM",
    }),
  ];
}

// ── AUTO-01 — rotation-from-automation Sentinel EGP enforced ───────────────
async function assessAutomation() {
  const features = await readFeatures();
  if (!features.capabilities?.sentinel) {
    return [
      assessment({
        control_id: "AUTO-01",
        scope: "estate",
        status: "N/A", // Sentinel isn't entitled on this Vault license — not applicable.
        evidence_refs: {
          detail: "Sentinel not present in this Vault license",
          source: features.source,
        },
        confidence: "HIGH",
      }),
    ];
  }
  const names = await sentinelEgpNames();
  const present = names.includes("rotation-from-automation");
  return [
    assessment({
      control_id: "AUTO-01",
      scope: "estate",
      status: present ? "PASS" : "FAIL",
      observed_value: { egp_present: present, egp_names: names },
      evidence_refs: { method: "vault LIST sys/policies/egp" },
      confidence: "HIGH",
    }),
  ];
}

// ── GOV-01 — four-eyes governance actively exercised ────────────────────────
async function assessGovernance() {
  const { rows } = await query(
    "SELECT status, accessor FROM approval_requests",
  );
  if (!rows.length) {
    return [
      assessment({
        control_id: "GOV-01",
        scope: "estate",
        status: "UNKNOWN",
        evidence_refs: { detail: "no approval_requests recorded yet" },
        confidence: "HIGH",
      }),
    ];
  }
  const resolvedWithAccessor = rows.filter(
    (r) => r.status !== "pending" && !!r.accessor,
  ).length;
  return [
    assessment({
      control_id: "GOV-01",
      scope: "estate",
      status: resolvedWithAccessor > 0 ? "PASS" : "FAIL",
      observed_value: {
        resolved_with_accessor: resolvedWithAccessor,
        total: rows.length,
      },
      evidence_refs: { method: "approval_requests.status/accessor" },
      confidence: "HIGH",
    }),
  ];
}

// ── Orchestration ────────────────────────────────────────────────────────

const ASSESSORS = [
  assessKeyInventory,
  assessTenantIsolation,
  assessRotationPolicy,
  assessKeyExpiry,
  assessOffboarding,
  assessAuditTrail,
  assessWorkloadIdentity,
  assessNegativeAuthz,
  assessAutomation,
  assessGovernance,
];

/**
 * Runs every control assessor and persists each result as a new
 * control_assessments row (append-only evidence log). Returns the raw,
 * freshly-assessed rows (not historical ones) — this run's evidence.
 */
export async function runControlAssessment() {
  const batches = await Promise.all(
    ASSESSORS.map((fn) =>
      fn().catch((err) => [
        assessment({
          control_id: "UNKNOWN-ERROR",
          scope: "estate",
          status: "UNKNOWN",
          evidence_refs: { error: err.message, assessor: fn.name },
          confidence: "HIGH",
        }),
      ]),
    ),
  );
  const flat = batches.flat();

  for (const a of flat) {
    if (a.control_id === "UNKNOWN-ERROR") continue; // assessor itself crashed — don't try to FK it
    await query(
      `INSERT INTO control_assessments
         (control_id, scope, status, desired_value, observed_value, evidence_refs, freshness_seconds, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        a.control_id,
        a.scope,
        a.status,
        a.desired_value ? JSON.stringify(a.desired_value) : null,
        a.observed_value ? JSON.stringify(a.observed_value) : null,
        JSON.stringify(a.evidence_refs ?? {}),
        a.freshness_seconds ?? 0,
        a.confidence,
      ],
    ).catch(() => {}); // one bad row must not lose the rest of the batch
  }
  return flat;
}

// Same worst-case-wins precedence for every control, whether it's a single
// estate-wide row (most controls) or many per-scope rows (ROT-POL-01):
// FAIL beats UNKNOWN beats PASS; N/A rows are excluded from the rollup
// entirely (they neither pass nor block — Design rule: "never scored
// against"), and a control with ONLY N/A rows rolls up to N/A itself.
export function rollupByControl(assessments) {
  const byControl = new Map();
  for (const a of assessments) {
    if (!byControl.has(a.control_id)) byControl.set(a.control_id, []);
    byControl.get(a.control_id).push(a);
  }
  const rollup = {};
  for (const [controlId, rows] of byControl) {
    const applicable = rows.filter((r) => r.status !== "N/A");
    if (!applicable.length) {
      rollup[controlId] = "N/A";
    } else if (applicable.some((r) => r.status === "FAIL")) {
      rollup[controlId] = "FAIL";
    } else if (applicable.some((r) => r.status === "UNKNOWN")) {
      rollup[controlId] = "UNKNOWN";
    } else {
      rollup[controlId] = "PASS";
    }
  }
  return rollup;
}

// The exact algorithm from prompts/21_evidence_model_v2.md Deliverable 3 —
// a single mandatory control at FAIL or UNKNOWN caps the level, regardless
// of how high everything else scores (input/32's "Governance = 0 but still
// Level 4" failure mode, countered).
export const MANDATORY_CONTROLS_PER_LEVEL = {
  1: ["KEY-INV-01"],
  2: ["KEY-INV-01", "TEN-ISO-01"],
  3: [
    "KEY-INV-01",
    "TEN-ISO-01",
    "ROT-POL-01",
    "AUD-01",
    "WLI-01",
    "NEG-AUTHZ-01",
  ],
  4: [
    "KEY-INV-01",
    "TEN-ISO-01",
    "ROT-POL-01",
    "AUD-01",
    "WLI-01",
    "NEG-AUTHZ-01",
    "AUTO-01",
  ],
  5: [
    "KEY-INV-01",
    "TEN-ISO-01",
    "ROT-POL-01",
    "AUD-01",
    "WLI-01",
    "NEG-AUTHZ-01",
    "AUTO-01",
    "GOV-01",
    // Prompt 29 — found live: KML-DESTR-01 is seeded mandatory:true
    // (migration 022) and the UI badges it "mandatory," but it was never
    // added here, so a genuine live FAIL on it sat directly under a
    // "5 / Governed" banner — contradicting this page's own stated
    // methodology ("a single mandatory control at FAIL or UNKNOWN caps the
    // level"). Scoped to level 5 only: this control governs completion of
    // the newest lifecycle stage (Prompt 28) and gating it at levels 1-4
    // would retroactively fail environments that never adopted expiry-date
    // desired state at all — that is the existing, correct N/A/UNKNOWN
    // case, not a FAIL, and is not what this fix is for.
    "KML-DESTR-01",
  ],
};

export function gatedLevel(rollup) {
  for (let level = 5; level >= 1; level--) {
    const required = MANDATORY_CONTROLS_PER_LEVEL[level];
    const allPass = required.every((id) => rollup[id] === "PASS");
    if (allPass) return level;
  }
  return 0;
}

export function levelCapReason(rollup, level) {
  const nextLevel = Math.min(5, level + 1);
  if (nextLevel === level) return null;
  const required = MANDATORY_CONTROLS_PER_LEVEL[nextLevel] ?? [];
  const blocking = required.filter((id) => rollup[id] !== "PASS");
  if (!blocking.length) return null;
  return `Level capped at ${level}: ${blocking.map((id) => `${id} is ${rollup[id] ?? "UNKNOWN"}`).join(", ")}`;
}

// Coverage counts real evidence units (every persisted assessment row this
// run), not collapsed controls — input/36's worked example: 10 in-scope
// controls, 6 PASS, 2 FAIL, 2 UNKNOWN -> Coverage = (6+2)/10 = 80%, not
// passCount/applicableCount. PASS and FAIL both count as "evidenced";
// UNKNOWN and N/A do not (UNKNOWN = no usable evidence, N/A = out of scope).
export function computeCoverage(assessments) {
  const applicable = assessments.filter((a) => a.status !== "N/A");
  if (!applicable.length) return 0;
  const evidenced = applicable.filter(
    (a) => a.status === "PASS" || a.status === "FAIL",
  ).length;
  return Math.round((evidenced / applicable.length) * 100);
}

// Confidence rollup — not averaged into a number (Design rule): worst-case
// wins, same as status rollup. Only rows that actually carry a PASS/FAIL
// verdict count; UNKNOWN/N/A rows have no confidence-bearing evidence.
export function computeConfidence(assessments) {
  const scored = assessments.filter(
    (a) => a.status === "PASS" || a.status === "FAIL",
  );
  if (!scored.length) return "LOW";
  if (scored.some((a) => a.confidence === "LOW")) return "LOW";
  if (scored.some((a) => a.confidence === "MEDIUM")) return "MEDIUM";
  return "HIGH";
}
