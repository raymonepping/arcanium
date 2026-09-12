// auth/authorize.js — Prompt 18. The ONE place mutation permissions are
// decided. Every mutating route calls authorize(); nothing else in the API
// inline-checks req.identity.persona against a literal string anymore.
//
// Deny-by-default: no (identity, action) pair is allowed unless an explicit
// rule says so. "UI hides a button" is not authorization — this is.
//
// Groups, not usernames (input/35/36): roles and tenant scope are derived
// from OIDC `groups` claims by groupsToIdentity(), called once at session
// creation (auth/index.js callback handler). `arcanium-supplier-admin` is
// read off its own explicit group — never inferred from "has a tenant
// group and nothing else" (input/36), so a future tenant-scoped role that
// ISN'T supplier-admin stays expressible without becoming one by accident.

const ROLE_GROUPS = {
  "arcanium-ciso": "ciso",
  "arcanium-architect": "architect",
  "arcanium-operator": "operator",
  "arcanium-auditor": "auditor",
  "arcanium-supplier-admin": "supplier-admin",
};

// Prompt 28 — every role name MATRIX recognizes, exported so
// routes/service-accounts.js can validate a machine identity's declared
// roles against the same set humans are drawn from, without hand-copying
// the list a second time.
export const VALID_ROLES = Object.freeze(Object.values(ROLE_GROUPS));

const TENANT_GROUP_PREFIX = "arcanium-tenant-";

// Prompt 27 — scoped-role group naming: "arcanium-<role>:env:<env>" or
// "arcanium-<role>:team:<team>". Deliberately excludes supplier-admin (its
// own tenant-scope mechanism above is unchanged and is not extended here —
// see this prompt's own design rule: "The supplier-admin role is unchanged.
// This prompt addresses operator-side and audit-side scoping, not
// supplier-side"). Matches "arcanium-operator" (not "arcanium-supplier-admin",
// which contains no ":" and never matches this pattern anyway) against the
// same role names ROLE_GROUPS already recognizes.
const SCOPED_GROUP_RE = /^arcanium-([a-z-]+):(env|team):(.+)$/;
const SCOPABLE_ROLES = new Set(["ciso", "architect", "operator", "auditor"]);

// Display precedence only (e.g. for a single `persona` badge in the UI /
// GET /auth/me) — authorization itself checks the full `roles` set, not
// just this one value.
const ROLE_PRECEDENCE = [
  "ciso",
  "architect",
  "operator",
  "auditor",
  "supplier-admin",
];

export function groupsToIdentity(groups = []) {
  const roles = [...new Set(groups.map((g) => ROLE_GROUPS[g]).filter(Boolean))];
  const tenantScopes = groups
    .filter((g) => g.startsWith(TENANT_GROUP_PREFIX))
    .map((g) => `suppliers/${g.slice(TENANT_GROUP_PREFIX.length)}`);

  // Prompt 27, Deliverable 1b — one scopes[] entry per scoped role, merging
  // every env/team tag that role was granted (an identity can hold
  // "arcanium-operator:env:staging" AND "arcanium-operator:env:production"
  // — one scoped operator grant covering both, not two separate entries).
  const scopedByRole = new Map();
  for (const g of groups) {
    const m = SCOPED_GROUP_RE.exec(g);
    if (!m) continue;
    const [, role, dim, value] = m;
    if (!SCOPABLE_ROLES.has(role)) continue; // unknown/non-scopable role — ignored, not an error
    if (!scopedByRole.has(role)) {
      scopedByRole.set(role, {
        role,
        envScopes: new Set(),
        teamScopes: new Set(),
      });
    }
    const entry = scopedByRole.get(role);
    (dim === "env" ? entry.envScopes : entry.teamScopes).add(value);
  }
  const scopes = [...scopedByRole.values()].map((e) => ({
    role: e.role,
    envScopes: [...e.envScopes],
    teamScopes: [...e.teamScopes],
  }));

  // Deliberately NOT falling back to a scoped role's name here (e.g.
  // scopes[0]?.role): primaryRole is persisted as `sessions.persona`, and
  // requireSession (auth/index.js) treats `[persona]` as an ESTATE-WIDE
  // role for authorize()'s step-1 check — falling back to a scoped-only
  // role name would silently promote "arcanium-operator:env:production"
  // (restricted) into unrestricted estate-wide "operator" the moment a
  // session was reconstructed on the next request. A scoped-only identity
  // is still allowed to log in (see auth/index.js's own callback handler,
  // which checks `scopes.length` as the alternate condition) with
  // primaryRole left null here; auth/index.js gives that case a distinct
  // sentinel persona value that MATRIX has no entry for.
  const primaryRole =
    ROLE_PRECEDENCE.find((r) => roles.includes(r)) || roles[0] || null;
  return { roles, tenantScopes, primaryRole, scopes };
}

// The exact matrix from input/35 — enforced, not documented.
// true = always allowed (estate-wide) · false = never · 'limited' = allowed
// only within the caller's own tenant scope (checked against `tenant`).
const MATRIX = {
  ciso: {
    read: true,
    provision: false,
    rotate: false,
    rewrap: false,
    destroy_request: true,
    approve: true,
    // Prompt 20 — 'reconcile' is the same row as 'rotate' for every persona:
    // correcting drift back to the desired rotation policy is operationally
    // equivalent to a rotate-class action (see authorize.js's own header
    // comment and prompts/20_desired_state_reconciliation.md Deliverable 4).
    reconcile: false,
  },
  architect: {
    read: true,
    provision: true,
    rotate: true,
    rewrap: false,
    destroy_request: true,
    approve: false,
    reconcile: true,
  },
  operator: {
    read: true,
    provision: true,
    rotate: true,
    rewrap: true,
    destroy_request: true,
    approve: false,
    reconcile: true,
  },
  auditor: {
    read: true,
    provision: false,
    rotate: false,
    rewrap: false,
    destroy_request: false,
    approve: false,
    reconcile: false,
  },
  "supplier-admin": {
    read: "limited",
    provision: "limited",
    rotate: "limited",
    rewrap: false,
    destroy_request: "limited",
    approve: false,
    reconcile: "limited",
  },
};

// Prompt 27 — one read-only lookup into MATRIX, for list-filtering helpers
// (auth/scope.js's teamReadScope) that need to know whether a role could
// ever perform an action WITHOUT re-deciding a specific resource — they
// still call authorize() itself for the actual per-request decision.
export function roleVerdict(role, action) {
  return MATRIX[role]?.[action] ?? false;
}

export const ACTIONS = Object.freeze([
  "read",
  "provision",
  "rotate",
  "rewrap",
  "destroy_request",
  "approve",
  "reconcile", // Prompt 20 — same row as 'rotate' in the matrix (see above)
]);

/**
 * authorize({ identity, action, tenant, env, team }) -> { decision: 'ALLOW'|'DENY', reason, role? }
 *
 * identity: req.identity as set by requireSession — { roles, tenantScopes, scopes, persona, ... }
 * action:   one of ACTIONS
 * tenant:   the resource's tenant scope, e.g. "suppliers/pepsi" — required
 *           whenever a 'limited' rule could apply; omit for estate-wide resources.
 * env:      Prompt 27 — the resource's environment tag (e.g. "production"),
 *           checked against a scoped grant's envScopes. Omit for resources
 *           with no environment concept (estate-level resources).
 * team:     Prompt 27 — the resource's team name (resolved by the caller via
 *           the team registry, Deliverable 2), checked against a scoped
 *           grant's teamScopes. Omit for resources with no team concept.
 *
 * Callers that omit env/team, or whose identity has no scoped grants
 * (identity.scopes is empty/absent), get exactly today's estate-wide
 * behavior — this is purely additive.
 */
export function authorize({ identity, action, tenant, env, team }) {
  if (!ACTIONS.includes(action)) {
    return { decision: "DENY", reason: `unknown action: ${action}` };
  }
  if (!identity) {
    return { decision: "DENY", reason: "no identity" };
  }

  const roles = identity.roles?.length
    ? identity.roles
    : [identity.persona].filter(Boolean);

  // Step 1 — estate-wide roles (unchanged behavior).
  for (const role of roles) {
    const rule = MATRIX[role];
    if (!rule) continue;
    const verdict = rule[action];

    if (verdict === true) {
      return { decision: "ALLOW", role };
    }
    if (verdict === "limited") {
      if (!tenant) {
        // A limited role with no resource tenant to check against a
        // (non-empty) tenant scope is denied, not silently widened to
        // estate-wide — deny-by-default applies here too.
        continue;
      }
      const scopes = identity.tenantScopes || [];
      if (scopes.includes(tenant)) {
        return { decision: "ALLOW", role, scoped: true, tenant };
      }
    }
  }

  // Step 2 — scoped grants (Prompt 27). Only reached when no estate-wide
  // role already allowed the action above — a scoped grant never widens
  // what an estate-wide role already permits, it only ever narrows.
  for (const grant of identity.scopes || []) {
    const rule = MATRIX[grant.role];
    if (!rule) continue;
    const verdict = rule[action];
    if (verdict !== true && verdict !== "limited") continue; // false — this role can never do this action, scoped or not

    // envScopes/teamScopes empty = "all" for that dimension (Deliverable 1c).
    if (grant.envScopes.length && (!env || !grant.envScopes.includes(env))) {
      continue;
    }
    if (
      grant.teamScopes.length &&
      (!team || !grant.teamScopes.includes(team))
    ) {
      continue;
    }
    // A 'limited' verdict still respects the identity's own tenantScopes
    // (only ever non-empty for supplier-admin in practice, since the new
    // scoped-group syntax deliberately excludes it — see groupsToIdentity)
    // — this generalizes correctly without a supplier-admin special case.
    if (verdict === "limited") {
      const tScopes = identity.tenantScopes || [];
      if (tScopes.length && (!tenant || !tScopes.includes(tenant))) continue;
    }

    return {
      decision: "ALLOW",
      role: grant.role,
      scoped: true,
      env: env ?? null,
      team: team ?? null,
    };
  }

  return {
    decision: "DENY",
    reason: "no matching allow rule",
    roles,
    action,
    tenant,
    env,
    team,
  };
}

// Express middleware factory — the common case (deny with 403, log nothing
// sensitive). `tenantOf(req)` returns the resource's tenant scope string or
// undefined for estate-wide resources; it may be async.
export function requireAuthorization(action, tenantOf) {
  return async (req, res, next) => {
    try {
      const tenant = tenantOf ? await tenantOf(req) : undefined;
      const result = authorize({ identity: req.identity, action, tenant });
      if (result.decision !== "ALLOW") {
        return res.status(403).json({
          error: "forbidden",
          action,
          reason: result.reason || "denied",
        });
      }
      req.authorization = result;
      next();
    } catch (err) {
      next(err);
    }
  };
}
