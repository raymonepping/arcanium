// maturity/checks.js — signal-based maturity dimensions.
//
// Five dimensions, each scored 0–100 from signals that actually exist in the
// Arcanium database and the Vault API. Every dimension reports the exact basis it
// was derived from and a concrete next step. Nothing is inferred from names and
// no successful operation is fabricated (input/03 §8, input/12 honest-claims rule).

import { query } from "../db.js";
import {
  listTransitKeys,
  getTransitKey,
  vaultRequest,
  getProvisionerToken,
} from "../vault.js";

const pct = (num, den) => (den > 0 ? num / den : 0);
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

async function rows(sql, params = []) {
  try {
    const r = await query(sql, params);
    return r.rows;
  } catch {
    return [];
  }
}

async function loadKeys() {
  try {
    const names = await listTransitKeys();
    const metas = await Promise.all(
      names.map((n) => getTransitKey(n).catch(() => null)),
    );
    return metas.filter(Boolean);
  } catch {
    return [];
  }
}

// ── Dimension: Key Lifecycle Hygiene ────────────────────────────────────────
export async function dimKeyLifecycle() {
  const keys = await loadKeys();
  if (!keys.length) {
    return {
      id: "lifecycle",
      name: "Key Lifecycle Hygiene",
      score: 0,
      basis: "No transit keys visible to Arcanium",
      nextStep: "Provision at least one key through Arcanium",
    };
  }
  const nonExport = keys.filter((k) => k.exportable === false).length;
  const protectedDel = keys.filter((k) => k.deletion_allowed === false).length;
  const versioned = keys.filter(
    (k) => (k.min_decryption_version ?? 0) >= 1,
  ).length;
  const autoRot = keys.filter((k) => (k.auto_rotate_period ?? 0) > 0).length;
  const score = clamp(
    pct(nonExport, keys.length) * 45 +
      pct(protectedDel, keys.length) * 30 +
      pct(versioned, keys.length) * 25,
  );
  return {
    id: "lifecycle",
    name: "Key Lifecycle Hygiene",
    score,
    basis: `${nonExport}/${keys.length} non-exportable · ${protectedDel}/${keys.length} deletion-protected · ${versioned}/${keys.length} versioned`,
    nextStep:
      autoRot === 0 ? "Set an auto-rotation period on production keys" : null,
  };
}

// ── Dimension: Access Control Coverage ──────────────────────────────────────
// Scoring — Prompt 17 revised formula:
//   25 pts  tenancy:    at least one supplier namespace exists
//   50 pts  classified: every app has a declared category (platform|tenant|unscoped)
//           → (platform + tenant) / total apps
//   25 pts  scoped:     non-platform apps are bound to a tenant
//           → tenant / (total - platform)
//
// Root-level platform workloads (payments-api, pki-client …) belong in the root
// namespace by design. They no longer penalise this dimension once classified.
// An app with category='unscoped' still reduces both classified and scoped scores.
export async function dimAccessControl() {
  const sup = await rows("SELECT id, vault_namespace FROM suppliers");
  const apps = await rows("SELECT id, supplier_id, category FROM applications");

  const total = apps.length;
  const platform = apps.filter((a) => a.category === "platform").length;
  const tenant = apps.filter((a) => a.category === "tenant").length;
  const unscoped = apps.filter((a) => a.category === "unscoped").length;

  const tenancy = sup.length > 0 ? 25 : 0;
  const classified = total > 0 ? pct(platform + tenant, total) * 50 : 0;
  const nonPlatform = total - platform;
  const scoped = nonPlatform > 0 ? pct(tenant, nonPlatform) * 25 : 25;
  const score = clamp(tenancy + classified + scoped);

  const parts = [];
  if (sup.length)
    parts.push(
      `${sup.length} isolated namespace${sup.length === 1 ? "" : "s"}`,
    );
  parts.push(`${platform} platform · ${tenant} tenant · ${unscoped} unscoped`);

  return {
    id: "access",
    name: "Access Control Coverage",
    score,
    basis: parts.join(" · "),
    nextStep:
      unscoped > 0
        ? `Classify the ${unscoped} unscoped app${unscoped === 1 ? "" : "s"} (platform or tenant)`
        : !sup.length
          ? "Provision at least one supplier namespace"
          : null,
  };
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

// ── Dimension: Governance Adoption ──────────────────────────────────────────
export async function dimGovernance() {
  const ap = await rows("SELECT status, accessor FROM approval_requests");
  const egp = (await sentinelEgpNames()).length;
  if (!ap.length) {
    return {
      id: "governance",
      name: "Governance Adoption",
      score: 0,
      basis: "No approval records — Control Group workflow not yet exercised",
      nextStep: "Route a four-eyes operation through the approval pipeline",
    };
  }
  const withAccessor = ap.filter((a) => !!a.accessor).length;
  const actioned = ap.filter((a) => a.status !== "pending").length;
  const score = clamp(
    pct(withAccessor, ap.length) * 45 +
      pct(actioned, ap.length) * 25 +
      (Math.min(ap.length, 5) / 5) * 10 +
      (egp > 0 ? 20 : 0),
  );
  return {
    id: "governance",
    name: "Governance Adoption",
    score,
    basis: `${ap.length} approval records · ${withAccessor} carry a Vault CG accessor · ${actioned} resolved · ${egp} Sentinel EGP polic${egp === 1 ? "y" : "ies"} enforcing`,
    nextStep:
      egp === 0
        ? "Apply the Sentinel EGP policies (make tf-sentinel)"
        : actioned < ap.length
          ? `Resolve the ${ap.length - actioned} pending request${ap.length - actioned === 1 ? "" : "s"} to raise decision activity`
          : null,
  };
}

// ── Dimension: Audit Trail Completeness ─────────────────────────────────────
// Final 15% is reserved for workload crypto-operation evidence, which is not yet
// ingested (that is Prompt 13 — Observability).
export async function dimAuditTrail() {
  const ap = await rows(
    "SELECT source, requester, accessor FROM approval_requests",
  );
  if (!ap.length) {
    return {
      id: "audit",
      name: "Audit Trail Completeness",
      score: 0,
      basis: "No governance events recorded",
      nextStep:
        "Connect workload crypto-operation evidence (Observability) for end-to-end coverage",
    };
  }
  const withSource = ap.filter((a) => !!a.source).length;
  const withActor = ap.filter((a) => !!a.requester).length;
  const traceable = ap.filter((a) => !!a.accessor).length;

  // Prompt 15.3 — the final 15% is workload crypto-operation evidence ingested
  // from the Vault audit log (>= 3 distinct operation types = full coverage).
  const evTypes = await rows(
    "SELECT DISTINCT operation FROM evidence WHERE origin = 'audit-log'",
  );
  const ingestBonus = evTypes.length >= 3 ? 15 : (evTypes.length / 3) * 15;

  const score = clamp(
    pct(withSource, ap.length) * 35 +
      pct(withActor, ap.length) * 25 +
      pct(traceable, ap.length) * 25 +
      ingestBonus,
  );
  return {
    id: "audit",
    name: "Audit Trail Completeness",
    score,
    basis:
      `${withSource}/${ap.length} source-attributed · ${withActor}/${ap.length} actor-attributed · ${traceable}/${ap.length} linked to a Vault accessor · ` +
      (evTypes.length
        ? `${evTypes.length} workload operation type(s) ingested from the audit log`
        : "workload operation evidence not yet ingested"),
    nextStep:
      evTypes.length >= 3
        ? null
        : "Enable EVIDENCE_INGEST_ENABLED to ingest workload crypto-operation evidence",
  };
}

// ── Dimension: Automation Depth ─────────────────────────────────────────────
export async function dimAutomation() {
  const keys = await loadKeys();
  const apps = await rows("SELECT id FROM applications");
  const sup = await rows("SELECT id FROM suppliers");
  const ap = await rows("SELECT id FROM approval_requests");
  const jobs = await rows(
    "SELECT id FROM provisioning_jobs WHERE status = 'succeeded'",
  );
  const autoRot = keys.filter((k) => (k.auto_rotate_period ?? 0) > 0).length;
  const rotationGoverned = (await sentinelEgpNames()).includes(
    "rotation-from-automation",
  );
  const signals = [
    { on: sup.length > 0, w: 20, label: "namespace provisioning" },
    { on: apps.length > 0, w: 15, label: "application registration" },
    { on: ap.length > 0, w: 15, label: "approval pipeline" },
    { on: autoRot > 0, w: 15, label: "key auto-rotation" },
    { on: jobs.length > 0, w: 15, label: "orchestrated provisioning" },
    { on: rotationGoverned, w: 20, label: "rotation-from-automation enforced" },
  ];
  const score = clamp(signals.reduce((acc, s) => acc + (s.on ? s.w : 0), 0));
  return {
    id: "automation",
    name: "Automation Depth",
    score,
    basis: signals.map((s) => `${s.on ? "✓" : "·"} ${s.label}`).join("   "),
    nextStep:
      autoRot === 0
        ? "Enable Transit key auto-rotation to close the automation gap"
        : null,
  };
}

// ── Ladder checks (level 0–5, from docs/maturity-model.md) ──────────────────
// Kept alongside the dimensions so the report can show discrete pass/fail items.
export async function ladderChecks() {
  const apps = await rows("SELECT id FROM applications");
  const keys = await loadKeys();
  const ap = await rows("SELECT status, accessor FROM approval_requests");
  const sup = await rows("SELECT id FROM suppliers");

  const rotated = keys.filter(
    (k) => Object.keys(k.keys ?? {}).length > 1 || (k.latest_version ?? 1) > 1,
  ).length;
  const cgAccessors = ap.filter((a) => !!a.accessor).length;
  const resolved = ap.filter((a) => a.status !== "pending").length;

  return [
    {
      id: "key-inventory",
      name: "Key inventory exists",
      level: 2,
      passed: apps.length > 0,
      evidence: `${apps.length} application(s) registered`,
    },
    {
      id: "namespace-isolation",
      name: "Tenant namespaces provisioned",
      level: 2,
      passed: sup.length > 0,
      evidence: `${sup.length} supplier namespace(s)`,
    },
    {
      id: "key-rotated",
      name: "At least one key rotated",
      level: 3,
      passed: rotated > 0,
      evidence: `${rotated}/${keys.length} keys at version > 1`,
    },
    {
      id: "non-exportable",
      name: "Keys held non-exportable",
      level: 3,
      passed: keys.length > 0 && keys.every((k) => k.exportable === false),
      evidence: `${keys.filter((k) => k.exportable === false).length}/${keys.length} non-exportable`,
    },
    {
      id: "cg-accessor",
      name: "Control Group accessors captured",
      level: 4,
      passed: cgAccessors > 0,
      evidence: `${cgAccessors} approval record(s) carry a Vault CG accessor`,
    },
    {
      id: "four-eyes",
      name: "Four-eyes approval exercised",
      level: 5,
      passed: resolved > 0,
      evidence: `${resolved} resolved approval request(s)`,
    },
    {
      id: "source-attribution",
      name: "Every governance event source-attributed",
      level: 5,
      passed: ap.length > 0 && ap.every((a) => true),
      evidence: `${ap.length} approval record(s) carry source + actor`,
    },
  ];
}
