// auth/index.js — Prompt 18 — OIDC (Keycloak, LDAP-federated) human
// authentication → server-side session. Replaces Prompt 14.5's Vault
// userpass login entirely (input/35/36: OpenLDAP is an identity store, never
// a direct AuthN target for Arcanium; Vault's own userpass/AppRole AuthN for
// workloads is untouched — this only changes how HUMANS sign in).
//
// Express is the confidential OIDC client end-to-end (input/36) — the
// browser only ever receives an opaque Arcanium session cookie. No OIDC
// token, Vault token, or LDAP credential ever reaches it.

import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import config from "../config.js";
import { query } from "../db.js";
import {
  buildAuthorizationRedirect,
  setPendingCookie,
  clearPendingCookie,
  exchangeCode,
  buildLogoutUrl,
} from "./oidc.js";
import { groupsToIdentity } from "./authorize.js";

export const authRouter = Router();

const COOKIE = "arc_session";
const TTL_S = 3600; // 1h absolute
const IDLE_TIMEOUT_S = 1800; // 30m idle

// No cookie-parser dependency — parse/set the cookies we use by hand.
function readCookie(req) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}
// Secure is safe here even over plain HTTP: this stack is exclusively
// accessed via http://localhost / http://127.0.0.1, both of which browsers
// treat as "potentially trustworthy" secure-context origins for cookie
// purposes regardless of scheme (W3C Secure Contexts). SameSite=Lax (not
// Strict) is required for the callback cookie's round trip; kept the same
// here for consistency and because it does not weaken anything on a
// same-origin-only frontend.
function setCookie(res, id) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(id)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TTL_S}`,
  );
}
function clearCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

// GET /api/v1/auth/login — the browser navigates here directly (not fetch).
// Builds the Keycloak authorization URL (state/nonce/PKCE all freshly
// random per input/35's checklist) and redirects.
authRouter.get("/login", async (req, res, next) => {
  try {
    if (!config.auth.enabled) {
      return res
        .status(400)
        .json({ error: "authentication is disabled on this deployment" });
    }
    const returnTo =
      typeof req.query.next === "string" && req.query.next.startsWith("/")
        ? req.query.next
        : "/";
    const { url, pending } = await buildAuthorizationRedirect(returnTo);
    setPendingCookie(res, pending);
    res.redirect(302, url);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/callback — Keycloak redirects the browser's top-level
// navigation here. Validates issuer, state, nonce, PKCE, signature,
// audience and expiry (all enforced inside oidc.exchangeCode via
// openid-client — this handler does not re-implement any of that), then
// creates the Arcanium session and clears the pending-flow cookie.
authRouter.get("/callback", async (req, res, next) => {
  clearPendingCookie(res);
  if (!config.auth.enabled) {
    return res
      .status(400)
      .json({ error: "authentication is disabled on this deployment" });
  }
  try {
    const { claims, returnTo } = await exchangeCode(req);
    const groups = Array.isArray(claims.groups) ? claims.groups : [];
    const { tenantScopes, primaryRole, scopes } = groupsToIdentity(groups);

    if (!primaryRole && !scopes.length) {
      // A real, authenticated Keycloak identity with no recognised Arcanium
      // group at all — neither an estate-wide role nor a scoped one — is
      // rejected, not silently defaulted to some role — deny by default
      // applies at the identity-mapping boundary too.
      return res.status(403).json({
        error: "authenticated but not authorized: no Arcanium role group",
      });
    }
    // Prompt 27 — a scoped-only identity (e.g. only
    // "arcanium-operator:env:production", no bare "arcanium-operator") has
    // no estate-wide primaryRole to store. "scoped" is a sentinel persona
    // value MATRIX has no entry for — requireSession's `roles: [persona]`
    // therefore correctly fails the estate-wide check and falls through to
    // authorize()'s scoped-grant path, instead of accidentally being
    // treated as an unrestricted role. GET /auth/me and the UI derive the
    // real display label from `scopes[0].role` when persona is this value.
    const persona = primaryRole ?? "scoped";

    const username = claims.preferred_username || claims.sub;
    const id = randomBytes(32).toString("hex");
    await query(
      `INSERT INTO sessions (id, username, persona, namespaces, groups, expires_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5, now() + interval '1 hour', now())`,
      [id, username, persona, tenantScopes, groups],
    );
    setCookie(res, id);
    // returnTo is normally relative and safe to redirect to as-is (validated
    // at /login to start with "/" — never attacker-controlled/absolute).
    // /api-docs is the one deliberate exception: it's registered with
    // Keycloak under the gateway's callback URL (ARCANIUM_API_CALLBACK_URL,
    // port 3000) so the exchange above always completes on whichever
    // container the gateway relays to, but /api-docs itself is only ever
    // served by arcanium-api-dev on its own published port — a bare
    // relative redirect would land the browser on the Nuxt UI's origin
    // instead, which has no such route (404). This is a narrow, allowlisted
    // absolute-redirect exception, not a general pattern — every other
    // returnTo value stays relative.
    const dest =
      returnTo === "/api-docs"
        ? `${config.apiExplorerPublicUrl}/api-docs`
        : returnTo;
    res.redirect(302, dest);
  } catch (err) {
    // Every rejection path (invalid state, wrong issuer, wrong audience,
    // expired/missing pending flow, signature failure) lands here as a
    // real, non-200 response — "rejected" per input/35's exit criteria,
    // not a silently-created session.
    const reason =
      err?.code === "NO_PENDING"
        ? "no pending sign-in (cookie missing or expired) — start again"
        : err?.message || "OIDC callback validation failed";
    res.status(401).json({ error: "sign-in rejected", reason });
  }
});

// GET /api/v1/auth/me
authRouter.get("/me", async (req, res, next) => {
  try {
    if (!config.auth.enabled)
      return res.json({
        enabled: false,
        user: "demo",
        persona: "operator",
        namespaces: [],
        scopes: [],
      });
    const id = readCookie(req);
    if (!id)
      return res
        .status(401)
        .json({ enabled: true, error: "not authenticated" });
    const { rows } = await query(
      `SELECT username, persona, namespaces, groups FROM sessions
       WHERE id = $1 AND expires_at > now() AND last_seen_at > now() - interval '${IDLE_TIMEOUT_S} seconds'`,
      [id],
    );
    if (!rows.length)
      return res.status(401).json({ enabled: true, error: "session expired" });
    // Prompt 27, Deliverable 4 — scopes mirrors req.identity.scopes exactly,
    // re-derived from the session's own stored `groups` (the same source
    // requireSession uses below), so /auth/me and the actual enforcement
    // path can never drift apart.
    const { scopes } = groupsToIdentity(rows[0].groups ?? []);
    res.json({
      enabled: true,
      user: rows[0].username,
      persona: rows[0].persona,
      namespaces: rows[0].namespaces ?? [],
      groups: rows[0].groups ?? [],
      scopes,
      demoSwitch: config.auth.demoSwitch,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout — destroys the Arcanium session and hands the UI
// a Keycloak RP-initiated-logout URL to complete (client-side full-page
// navigation) so the Keycloak-side SSO session ends too, not just Arcanium's.
authRouter.post("/logout", async (req, res, next) => {
  try {
    const id = readCookie(req);
    if (id)
      await query("DELETE FROM sessions WHERE id = $1", [id]).catch(() => {});
    clearCookie(res);
    const logoutUrl = config.oidc.enabled ? buildLogoutUrl() : null;
    res.json({ ok: true, logoutUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/demo-persona  { persona }  — presentation-only switch.
// Overrides the DISPLAY/effective role for this session only; it does not
// touch the underlying OIDC identity or group membership, and is entirely
// gated off by default (ARCANIUM_DEMO_PERSONA_SWITCH). docs/personas.md
// already documents this as presentation theater, not a security control.
authRouter.post("/demo-persona", async (req, res, next) => {
  try {
    if (!config.auth.enabled || !config.auth.demoSwitch)
      return res.status(403).json({ error: "demo persona switch not enabled" });
    const id = readCookie(req);
    const persona = String((req.body ?? {}).persona ?? "");
    if (!["ciso", "architect", "operator", "auditor"].includes(persona))
      return res.status(400).json({ error: "unknown persona" });
    if (!id) return res.status(401).json({ error: "not authenticated" });
    await query("UPDATE sessions SET persona = $2 WHERE id = $1", [
      id,
      persona,
    ]);
    res.json({ persona });
  } catch (err) {
    next(err);
  }
});

// Prompt 15.2 / 18 — supplier-admin tenant scoping.
// Returns { scoped: bool, supplierIds: string[], namespaces: string[] }.
// A non-scoped identity (or auth disabled) sees everything. tenantScopes
// now derive from OIDC groups (stored on the session row at callback time
// as `namespaces`) rather than a username-based lookup — the shape this
// function returns is unchanged, so every existing caller keeps working.
export async function tenantScope(req) {
  const id = req.identity;
  if (!id || id.persona !== "supplier-admin" || !id.namespaces?.length) {
    return { scoped: false, supplierIds: null, namespaces: [] };
  }
  const { rows } = await query(
    `SELECT id FROM suppliers WHERE vault_namespace = ANY($1)`,
    [id.namespaces],
  );
  return {
    scoped: true,
    supplierIds: rows.map((r) => r.id),
    namespaces: id.namespaces,
  };
}

// Prompt 28, Deliverable 2 — hash the presented token, look up the service
// account it belongs to, and build the SAME req.identity shape the cookie
// path builds. authorize() is never told which source an identity came
// from — this is the whole point (no parallel authorization path).
function authenticateServiceAccount(token, req, res, next) {
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  query(
    `SELECT t.id AS token_id, sa.id AS sa_id, sa.name, sa.roles, sa.tenant_scopes, sa.revoked_at AS sa_revoked_at
       FROM service_account_tokens t
       JOIN service_accounts sa ON sa.id = t.service_account_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()`,
    [tokenHash],
  )
    .then(({ rows }) => {
      if (!rows.length)
        return res.status(401).json({ error: "invalid or expired token" });
      const sa = rows[0];
      if (sa.sa_revoked_at)
        return res.status(401).json({ error: "service account revoked" });

      req.identity = {
        // "service-account:<name>" — never confusable with a real human
        // username (Prompt 18's usernames never contain a colon), so
        // audit trails (approvals.requester, lifecycle_events.actor, etc.)
        // stay honestly attributable to a machine caller, not a person.
        user: `service-account:${sa.name}`,
        persona: sa.roles[0] ?? "service-account",
        namespaces: sa.tenant_scopes ?? [],
        roles: sa.roles,
        tenantScopes: sa.tenant_scopes ?? [],
        scopes: [], // Prompt 27's env/team scoping is a human-group concept; not extended to service accounts here
        groups: [],
        serviceAccount: true,
      };
      // Fire-and-forget, same non-blocking pattern as the session's own
      // idle-timeout touch below.
      query(
        "UPDATE service_account_tokens SET last_used_at = now() WHERE id = $1",
        [sa.token_id],
      ).catch(() => {});
      query("UPDATE service_accounts SET last_used_at = now() WHERE id = $1", [
        sa.sa_id,
      ]).catch(() => {});
      next();
    })
    .catch(next);
}

// Middleware: enforce a session on /api/v1/** (except auth/*) when enabled.
// Builds req.identity with `roles`/`tenantScopes` for auth/authorize.js, in
// addition to the legacy `persona`/`namespaces` shape existing routes read.
export function requireSession(req, res, next) {
  if (!config.auth.enabled) {
    req.identity = {
      user: "demo",
      persona: "operator",
      namespaces: [],
      roles: ["operator"],
      tenantScopes: [],
      scopes: [],
      groups: [],
    };
    return next();
  }
  const openPaths = [/^\/health/, /^\/api\/v1\/auth\//];
  if (openPaths.some((r) => r.test(req.path))) return next();

  // Prompt 28, Deliverable 2 — machine-to-machine: Authorization: Bearer is
  // checked FIRST and, when present, is the only path taken (a request
  // carrying both a bearer token and a stale cookie should authenticate as
  // the token, not silently fall back). This is additive — the cookie path
  // below is completely unchanged for every request that doesn't send this
  // header, and authorize() sees no difference between the two: both build
  // the exact same req.identity shape.
  const authHeader = req.headers.authorization || "";
  const bearerMatch = /^Bearer\s+(\S+)$/i.exec(authHeader);
  if (bearerMatch) {
    return authenticateServiceAccount(bearerMatch[1], req, res, next);
  }

  const id = readCookie(req);
  if (!id) return res.status(401).json({ error: "authentication required" });
  query(
    `SELECT username, persona, namespaces, groups FROM sessions
     WHERE id = $1 AND expires_at > now() AND last_seen_at > now() - interval '${IDLE_TIMEOUT_S} seconds'`,
    [id],
  )
    .then(({ rows }) => {
      if (!rows.length)
        return res.status(401).json({ error: "session expired" });
      // `roles` stays derived from the stored `persona` (unchanged from
      // before this prompt) — a session acts as one estate-wide role at a
      // time, and demo-persona (below) legitimately overrides which one
      // that is, for presentations. `scopes` is new: re-derived fresh from
      // the session's own stored `groups` on every request — demo-persona
      // never writes to `groups`, so it structurally cannot grant a scoped
      // env/team override (Deliverable 4's own requirement), while a real
      // scoped-role group membership is always reflected correctly here
      // regardless of which persona is currently in effect for the session.
      const { scopes } = groupsToIdentity(rows[0].groups ?? []);
      req.identity = {
        user: rows[0].username,
        persona: rows[0].persona,
        namespaces: rows[0].namespaces ?? [],
        roles: [rows[0].persona],
        tenantScopes: rows[0].namespaces ?? [],
        scopes,
        groups: rows[0].groups ?? [],
      };
      // Idle-timeout sliding window — fire-and-forget, never blocks the request.
      query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [
        id,
      ]).catch(() => {});
      next();
    })
    .catch(next);
}
