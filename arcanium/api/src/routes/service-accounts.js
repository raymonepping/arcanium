// routes/service-accounts.js — Prompt 28, Deliverable 2: machine-to-machine
// identity management. Estate-wide only (a human architect/operator issues
// and revokes these; a service account's OWN roles/tenant_scopes may be
// narrow, but the management plane itself is flat, same as teams.js).
//
// Token material: a random 256-bit value is returned in plaintext EXACTLY
// ONCE, at issuance — the table only ever stores its SHA-256 hash. Nothing
// in this file ever selects/returns token_hash to a client.

import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { query } from "../db.js";
import { authorize, VALID_ROLES } from "../auth/authorize.js";

export const serviceAccountsRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[a-z0-9_-]{1,64}$/i;
const DEFAULT_TOKEN_TTL_DAYS = 90;
const MAX_TOKEN_TTL_DAYS = 365;

function validateUuid(id) {
  if (!UUID_RE.test(id)) {
    const err = new Error("invalid id format");
    err.status = 400;
    throw err;
  }
}
function notFound() {
  const err = new Error("not found");
  err.status = 404;
  return err;
}

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Fields returned for a service account — NEVER token_hash, never touches
// service_account_tokens' secret material.
const SA_COLUMNS =
  "id, name, description, roles, tenant_scopes, created_by, created_at, last_used_at, revoked_at, revoked_by";

// GET /api/v1/service-accounts — estate-wide `read` only.
serviceAccountsRouter.get("/", async (req, res, next) => {
  try {
    const decision = authorize({ identity: req.identity, action: "read" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "read",
        reason: decision.reason,
      });
    const { rows } = await query(
      `SELECT ${SA_COLUMNS} FROM service_accounts ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/service-accounts/:id
serviceAccountsRouter.get("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "read" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "read",
        reason: decision.reason,
      });
    const { rows } = await query(
      `SELECT ${SA_COLUMNS} FROM service_accounts WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) return next(notFound());
    // Token metadata (never the hash, never the plaintext) — id, expiry,
    // last use, revocation — so an operator can see what's live without
    // ever seeing secret material.
    const { rows: tokens } = await query(
      `SELECT id, description, expires_at, created_at, last_used_at, revoked_at
         FROM service_account_tokens WHERE service_account_id = $1 ORDER BY created_at DESC`,
      [req.params.id],
    );
    res.json({ ...rows[0], tokens });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/service-accounts — estate-wide `provision` only. Machines
// don't self-issue; only a human architect/operator creates one.
serviceAccountsRouter.post("/", async (req, res, next) => {
  try {
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { name, description, roles, tenant_scopes } = req.body ?? {};
    if (!name || !NAME_RE.test(name))
      return res.status(400).json({
        error: "name is required and must match /^[a-z0-9_-]{1,64}$/i",
        field: "name",
      });
    if (
      !Array.isArray(roles) ||
      !roles.length ||
      roles.some((r) => !VALID_ROLES.includes(r))
    )
      return res.status(400).json({
        error: `roles must be a non-empty array of: ${VALID_ROLES.join(", ")}`,
        field: "roles",
      });
    if (
      tenant_scopes !== undefined &&
      tenant_scopes !== null &&
      (!Array.isArray(tenant_scopes) ||
        tenant_scopes.some((t) => typeof t !== "string"))
    )
      return res.status(400).json({
        error:
          "tenant_scopes must be an array of strings or null (null = estate-wide)",
        field: "tenant_scopes",
      });

    const { rows } = await query(
      `INSERT INTO service_accounts (name, description, roles, tenant_scopes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SA_COLUMNS}`,
      [
        name,
        description ?? null,
        roles,
        tenant_scopes ?? null,
        req.identity?.user ?? "arcanium",
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ error: "service account name already registered" });
    next(err);
  }
});

// DELETE /api/v1/service-accounts/:id — revoke (not a hard delete: the row
// stays, marked revoked, for audit history — same tombstone discipline
// Deliverable 6's offboarding workflow uses for desired_state).
serviceAccountsRouter.delete("/:id", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { rows } = await query(
      `UPDATE service_accounts SET revoked_at = now(), revoked_by = $2
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING ${SA_COLUMNS}`,
      [req.params.id, req.identity?.user ?? "arcanium"],
    );
    if (!rows.length) {
      const { rows: exists } = await query(
        "SELECT id FROM service_accounts WHERE id = $1",
        [req.params.id],
      );
      if (!exists.length) return next(notFound());
      return res.status(409).json({ error: "service account already revoked" });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/service-accounts/:id/tokens — issue a new token. The
// plaintext token is present in THIS response only — never again, not even
// to this same caller.
serviceAccountsRouter.post("/:id/tokens", async (req, res, next) => {
  try {
    validateUuid(req.params.id);
    const decision = authorize({ identity: req.identity, action: "provision" });
    if (decision.decision !== "ALLOW")
      return res.status(403).json({
        error: "forbidden",
        action: "provision",
        reason: decision.reason,
      });
    const { rows: sa } = await query(
      "SELECT id, revoked_at FROM service_accounts WHERE id = $1",
      [req.params.id],
    );
    if (!sa.length) return next(notFound());
    if (sa[0].revoked_at)
      return res
        .status(409)
        .json({ error: "cannot issue a token for a revoked service account" });

    const { description, expires_in_days } = req.body ?? {};
    const ttlDays = Number.isFinite(Number(expires_in_days))
      ? Math.min(Math.max(1, Number(expires_in_days)), MAX_TOKEN_TTL_DAYS)
      : DEFAULT_TOKEN_TTL_DAYS;

    const token = randomBytes(32).toString("hex"); // 256 bits
    const tokenHash = hashToken(token);
    const { rows } = await query(
      `INSERT INTO service_account_tokens (service_account_id, token_hash, description, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
       RETURNING id, expires_at`,
      [req.params.id, tokenHash, description ?? null, String(ttlDays)],
    );
    res.status(201).json({
      token_id: rows[0].id,
      token,
      expires_at: rows[0].expires_at,
      warning: "Store this token securely — it will not be shown again",
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/service-accounts/:id/tokens/:token_id — revoke one token
// without revoking the whole service account.
serviceAccountsRouter.delete(
  "/:id/tokens/:token_id",
  async (req, res, next) => {
    try {
      validateUuid(req.params.id);
      validateUuid(req.params.token_id);
      const decision = authorize({
        identity: req.identity,
        action: "provision",
      });
      if (decision.decision !== "ALLOW")
        return res.status(403).json({
          error: "forbidden",
          action: "provision",
          reason: decision.reason,
        });
      const { rows } = await query(
        `UPDATE service_account_tokens SET revoked_at = now()
       WHERE id = $1 AND service_account_id = $2 AND revoked_at IS NULL
       RETURNING id`,
        [req.params.token_id, req.params.id],
      );
      if (!rows.length) return next(notFound());
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
