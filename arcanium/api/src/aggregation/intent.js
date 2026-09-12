// aggregation/intent.js — Prompt 25: Unified Cryptographic Service Intent View.
//
// A read-model, not a new source of truth. Every field here is pulled from
// a table or live Vault read that Phases 18-21 already created — nothing is
// invented, nothing is interpolated from adjacent data. If a specific
// section has no data yet, it comes back empty/UNKNOWN, never omitted and
// never a plausible-looking guess.
//
// Two deliberate shape deviations from input/34's illustrative single-app
// example, both because this project's own demo data has applications with
// MORE THAN ONE crypto profile (ticket-service, pki-client both have two):
//   - `custody` is an array (one entry per crypto profile), not one object —
//     a single scalar would have to arbitrarily pick (or fabricate a merge
//     of) one profile's custody when an app genuinely has more than one.
//   - `assessment.reconciliation` is an array (one entry per desired_state
//     row), not a single {reconciliation, disposition} pair — same reason:
//     an app with two keys can have two independently-assessed statuses,
//     and collapsing them into one value would be exactly the "fabricated
//     aggregation" this phase's design rules forbid.

import { query } from "../db.js";
import { getTransitKey, getHsmTransitKey } from "../vault.js";
import { custodyOf } from "../routes/keys.js";
import { getDispositionFor } from "../reconciliation/engine.js";

function keyNameFromPath(vaultPath) {
  return vaultPath.split("/").pop();
}

// Returns null if the application doesn't exist. Callers are responsible
// for tenant-scoping (this module has no notion of a caller identity).
export async function getApplicationIntent(appId) {
  const { rows: appRows } = await query(
    `SELECT a.id, a.name, a.description, a.category, a.supplier_id, a.environment,
            a.offboarding_initiated_at, a.offboarded_at, s.vault_namespace
       FROM applications a LEFT JOIN suppliers s ON s.id = a.supplier_id
      WHERE a.id = $1`,
    [appId],
  );
  if (!appRows.length) return null;
  const app = appRows[0];
  // Same fallback maturity/controls.js's own ROT-POL-01 scope-writer uses
  // ("${r.vault_namespace ?? 'root'}/...") — platform-category applications
  // have no supplier, hence no vault_namespace, and their control scope
  // prefix is "root/<app>/..." rather than "<namespace>/<app>/...".
  const namespace = app.vault_namespace ?? "root";

  const { rows: profiles } = await query(
    "SELECT id, type, vault_path, custody, rotation_days, created_at FROM crypto_profiles WHERE application_id = $1 ORDER BY created_at",
    [appId],
  );

  const requirements = {
    encryption: false,
    signing: false,
    kmip: false,
    tls: false,
  };
  const custody = [];
  for (const p of profiles) {
    const keyName = keyNameFromPath(p.vault_path);
    let live = null;
    if (p.type === "transit" || p.type === "managed_key") {
      // Structural fact, always reliable regardless of Vault reachability:
      // a transit/managed_key profile exists specifically to encrypt.
      requirements.encryption = true;
      // Whether it ALSO supports signing is genuinely ambiguous from the
      // profile type alone (aes256-gcm96 does not; rsa/ecdsa do) — only
      // set true on a live, confirmed read, never guessed. A failed read
      // leaves `signing` at its current value rather than fabricating one.
      try {
        live = await getTransitKey(keyName);
      } catch {
        try {
          live = await getHsmTransitKey(keyName);
        } catch {
          live = null;
        }
      }
      if (live?.supports_signing) requirements.signing = true;
    }
    if (p.type === "pki") requirements.tls = true;
    if (p.type === "kmip") requirements.kmip = true;

    custody.push({
      profile_id: p.id,
      key_name: keyName,
      vault_path: p.vault_path,
      type: p.type,
      custody: live ? custodyOf(live) : (p.custody ?? "unknown"),
      hsm_backed: live
        ? Boolean(live._managedKey || live.type === "managed_key")
        : null, // null = not live-confirmable right now, never guessed as false
      rotation_days: p.rotation_days,
    });
  }

  const { rows: desiredState } = await query(
    `SELECT id, key_name, requirement, desired_value, source, version,
            changed_by, changed_groups, changed_reason, created_at, updated_at
       FROM desired_state WHERE application_id = $1 ORDER BY updated_at DESC`,
    [appId],
  );

  const dsIds = desiredState.map((d) => d.id);
  let observedState = [];
  if (dsIds.length) {
    const { rows } = await query(
      `SELECT DISTINCT ON (desired_state_id) *
         FROM reconciliation_runs
        WHERE desired_state_id = ANY($1)
        ORDER BY desired_state_id, observed_at DESC`,
      [dsIds],
    );
    observedState = rows;
  }

  const reconciliation = [];
  for (const d of desiredState) {
    const run = observedState.find((r) => r.desired_state_id === d.id);
    reconciliation.push({
      desired_state_id: d.id,
      key_name: d.key_name,
      requirement: d.requirement,
      observation_status: run?.status ?? "UNKNOWN",
      disposition: run ? await getDispositionFor(d.id, run.status) : "OPEN",
      observed_at: run?.observed_at ?? null,
    });
  }

  const { rows: controls } = await query(
    `SELECT DISTINCT ON (control_id, scope) ca.*, c.requirement, c.mandatory, c.dimension
       FROM control_assessments ca JOIN controls c ON c.id = ca.control_id
      WHERE ca.scope LIKE $1
      ORDER BY control_id, scope, assessed_at DESC`,
    [`${namespace}/${app.name}/%`],
  );

  const keyNames = profiles.map((p) => keyNameFromPath(p.vault_path));

  // Filtered by key_name, not just app_id — found live while proving this
  // view: provisioner/key.js's requestKeyDestroy() attaches EVERY destroy
  // request's app_id to "the first registered application" (an FK-
  // satisfying placeholder, not the key's real owner), so app_id alone
  // would misattribute another application's destroy request into this
  // one's governance section whenever that placeholder happens to be this
  // app. Requiring the key_name to actually belong to one of this
  // application's own crypto_profiles is the correct filter regardless of
  // which path created the approval.
  const { rows: approvals } = keyNames.length
    ? await query(
        `SELECT id, key_name, action, status, requester, approver, reason, created_at, updated_at
             FROM approval_requests
            WHERE app_id = $1 AND key_name = ANY($2)
            ORDER BY created_at DESC LIMIT 20`,
        [appId, keyNames],
      )
    : { rows: [] };
  const { rows: lcEvents } = await query(
    `SELECT id, event AS operation, resource_type, resource_id, detail, actor, source, created_at AS ts
       FROM lifecycle_events
      WHERE (resource_type = 'application' AND resource_id = $1)
         OR (resource_type = 'key' AND resource_id = ANY($2))
      ORDER BY created_at DESC LIMIT 20`,
    [appId, keyNames],
  );
  let evidenceRows = [];
  if (keyNames.length) {
    const { rows } = await query(
      `SELECT id, operation, resource_type, resource_id, outcome, actor,
              source AS evidence_source, origin, ts
         FROM evidence WHERE resource_id = ANY($1) ORDER BY ts DESC LIMIT 20`,
      [keyNames],
    );
    evidenceRows = rows;
  }
  const evidence = [
    ...lcEvents.map((e) => ({ kind: "lifecycle_event", ...e })),
    ...evidenceRows.map((e) => ({ kind: "evidence", ...e })),
  ]
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 20);

  // Deliverable 3's entry-story framing, computed here from real data
  // presence — the caller (the route) appends "Tenant isolation view" for
  // scoped sessions, since that's a property of who's asking, not of this
  // application's own data, and this module has no notion of a caller.
  const entryStoryLabels = [];
  if (desiredState.length) entryStoryLabels.push("Lifecycle view");
  if (approvals.length) entryStoryLabels.push("Governance view");

  return {
    application_id: app.id,
    application: app.name,
    tenant: namespace,
    // Prompt 27 added applications.environment — this was hardcoded null
    // here (with a comment saying no such column existed) until this
    // prompt's own audit found it stale and wired it to the real value.
    environment: app.environment,
    // Prompt 28, Deliverable 6 — an application mid-offboarding (or fully
    // offboarded) is labeled here, never displayed as a normal healthy
    // application. null/null means "not offboarding."
    offboarding: {
      initiated_at: app.offboarding_initiated_at ?? null,
      offboarded_at: app.offboarded_at ?? null,
    },
    requirements,
    custody,
    governance: {
      rotation_policies: desiredState
        .filter((d) => d.requirement === "rotation_period")
        .map((d) => ({
          desired_state_id: d.id,
          key_name: d.key_name,
          desired_days: d.desired_value?.days ?? null,
          source: d.source,
          changed_by: d.changed_by,
          changed_reason: d.changed_reason,
          updated_at: d.updated_at,
        })),
      // A real code invariant (provisioner/key.js's requestKeyDestroy()
      // unconditionally creates an approval_requests row before any key is
      // destroyed), not a per-application configurable setting Arcanium
      // tracks yet — true for every application today.
      destruction_requires_approval: true,
      approvals,
    },
    desired_state: desiredState,
    observed_state: observedState,
    assessment: { reconciliation, controls },
    evidence,
    _entryStoryLabels: entryStoryLabels,
  };
}
