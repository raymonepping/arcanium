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

const TENANT_GROUP_PREFIX = "arcanium-tenant-";

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
  const primaryRole =
    ROLE_PRECEDENCE.find((r) => roles.includes(r)) || roles[0] || null;
  return { roles, tenantScopes, primaryRole };
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
 * authorize({ identity, action, tenant }) -> { decision: 'ALLOW'|'DENY', reason, role? }
 *
 * identity: req.identity as set by requireSession — { roles, tenantScopes, persona, ... }
 * action:   one of ACTIONS
 * tenant:   the resource's tenant scope, e.g. "suppliers/pepsi" — required
 *           whenever a 'limited' rule could apply; omit for estate-wide resources.
 */
export function authorize({ identity, action, tenant }) {
  if (!ACTIONS.includes(action)) {
    return { decision: "DENY", reason: `unknown action: ${action}` };
  }
  if (!identity) {
    return { decision: "DENY", reason: "no identity" };
  }

  const roles = identity.roles?.length
    ? identity.roles
    : [identity.persona].filter(Boolean);

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

  return {
    decision: "DENY",
    reason: "no matching allow rule",
    roles,
    action,
    tenant,
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
