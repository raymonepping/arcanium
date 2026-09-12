// auth/scope.js — Prompt 27, Deliverable 3/5: team-scoped LIST filtering.
//
// tenantScope() (auth/index.js) already narrows a LIST query for a
// supplier-admin's own tenant. This is the same idea for the NEW
// team-scoped grants Prompt 27 adds: an identity with no estate-wide read
// role but a scoped grant like "arcanium-auditor:team:platform" should see
// exactly that team's applications/controls, not everything and not a 403
// (per this prompt's own Configuration C / Deliverable 6 test case 2 — read
// is allowed but scoped, distinct from denied outright).
//
// Kept separate from tenantScope(): the two dimensions are independent
// (Deliverable 1's design rule), and a caller composes both rather than one
// subsuming the other.

import { roleVerdict } from "./authorize.js";
import { resolveSupplierIdsForTeam } from "../teams/registry.js";

/**
 * Resolves the effective supplier_id-based read scope for an identity that
 * has NO estate-wide read role but does hold a team-scoped grant.
 *
 * Returns:
 *   { scoped: false }                     — nothing to narrow by (caller
 *                                            should fall through to its own
 *                                            estate-wide/tenant-scope logic)
 *   { scoped: true, supplierIds: null }   — a team grant that covers every
 *                                            supplier (team.supplier_ids IS
 *                                            NULL) — read allowed, unscoped
 *   { scoped: true, supplierIds: [...] }  — narrowed to exactly these
 *                                            supplier ids (possibly empty —
 *                                            a real team with no suppliers
 *                                            assigned yet, or an unknown
 *                                            team name in a stale group)
 */
export async function teamReadScope(identity) {
  const teamNames = new Set();
  for (const grant of identity?.scopes || []) {
    const verdict = roleVerdict(grant.role, "read");
    if (verdict !== true && verdict !== "limited") continue;
    for (const t of grant.teamScopes) teamNames.add(t);
  }
  if (!teamNames.size) return { scoped: false };

  let supplierIds = [];
  for (const name of teamNames) {
    const ids = await resolveSupplierIdsForTeam(name);
    if (ids === undefined) continue; // unknown team name — contributes nothing, not an error
    if (ids === null) return { scoped: true, supplierIds: null }; // this team alone covers everything
    supplierIds = [...new Set([...supplierIds, ...ids])];
  }
  return { scoped: true, supplierIds };
}

// Prompt 27, Deliverable 5 (authorization audit) — the LIST routes
// (GET /applications, GET /controls, GET /reconciliation) all narrow by
// scoped grants now; a single-resource GET by id (GET /applications/:id,
// GET /applications/:id/intent, GET /reconciliation/:run_id) previously
// only ever checked tenantScope() (supplier-admin) — a team- or env-scoped
// identity with no matching estate-wide read could fetch ANY resource
// directly by id/uuid, bypassing the very filter that kept it out of the
// list. Found live while auditing Prompts 20-26's routes for this prompt's
// own required cross-cutting check; fixed by giving those three routes
// this same resolution to consult in addition to tenantScope().
//
// Returns true when the identity's scoped grants (if it has NO estate-wide
// read role) do NOT cover this resource's supplier_id/environment — the
// caller should then respond exactly like a tenantScope() mismatch (404,
// not 403 — "doesn't exist" is the existing, established convention for a
// scoped-out single resource in this codebase).
export async function scopedReadDenied(identity, { supplierId, env } = {}) {
  const estateWideRead = (identity?.roles || []).some(
    (r) => roleVerdict(r, "read") === true,
  );
  if (estateWideRead) return false;

  let anyGrant = false;
  let envRestricted = false;
  let envSatisfied = false;
  for (const g of identity?.scopes || []) {
    const v = roleVerdict(g.role, "read");
    if (v !== true && v !== "limited") continue;
    anyGrant = true;
    if (g.envScopes.length) {
      envRestricted = true;
      if (env && g.envScopes.includes(env)) envSatisfied = true;
    } else {
      envSatisfied = true; // at least one grant is unrestricted by env
    }
  }
  if (!anyGrant) return false; // no scoped read grant at all — defer to tenantScope()/whatever else gates this route
  const envOk = !envRestricted || envSatisfied;

  const team = await teamReadScope(identity);
  const teamOk =
    !team.scoped ||
    team.supplierIds === null ||
    !supplierId ||
    team.supplierIds.includes(supplierId);

  return !(envOk && teamOk);
}
