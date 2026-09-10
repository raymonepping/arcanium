// auth/index.js — Prompt 14.5 — human authentication (Vault userpass → session).
// Disabled unless ARCANIUM_AUTH_ENABLED=true.

import { Router } from "express";
import { randomBytes } from "node:crypto";
import config from "../config.js";
import { query } from "../db.js";
import { vaultRequest } from "../vault.js";

export const authRouter = Router();

const COOKIE = "arc_session";
const TTL_S = 3600; // 1h

// No cookie-parser dependency — parse/set the one cookie we use by hand.
function readCookie(req) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}
function setCookie(res, id) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_S}`,
  );
}
function clearCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  );
}

// POST /api/v1/auth/login  { username, password }
authRouter.post("/login", async (req, res, next) => {
  try {
    if (!config.auth.enabled)
      return res
        .status(400)
        .json({ error: "authentication is disabled on this deployment" });
    const { username, password } = req.body ?? {};
    if (!username || !password)
      return res.status(400).json({ error: "username and password required" });

    // Vault is authoritative for the credential.
    try {
      await vaultRequest(
        "POST",
        `auth/userpass/login/${encodeURIComponent(username)}`,
        {
          password,
        },
      );
    } catch {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const persona = config.auth.personaByUser[username] ?? "operator";
    // supplier-admin personas are scoped to their tenant namespace.
    const namespaces =
      persona === "supplier-admin"
        ? [`suppliers/${username.replace(/-admin$/, "")}`]
        : [];

    const id = randomBytes(32).toString("hex");
    await query(
      `INSERT INTO sessions (id, username, persona, namespaces, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '1 hour')`,
      [id, username, persona, namespaces],
    );
    setCookie(res, id);
    res.json({ user: username, persona, namespaces });
  } catch (err) {
    next(err);
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
      });
    const id = readCookie(req);
    if (!id)
      return res
        .status(401)
        .json({ enabled: true, error: "not authenticated" });
    const { rows } = await query(
      `SELECT username, persona, namespaces FROM sessions
       WHERE id = $1 AND expires_at > now()`,
      [id],
    );
    if (!rows.length)
      return res.status(401).json({ enabled: true, error: "session expired" });
    res.json({
      enabled: true,
      user: rows[0].username,
      persona: rows[0].persona,
      namespaces: rows[0].namespaces ?? [],
      demoSwitch: config.auth.demoSwitch,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout
authRouter.post("/logout", async (req, res, next) => {
  try {
    const id = readCookie(req);
    if (id)
      await query("DELETE FROM sessions WHERE id = $1", [id]).catch(() => {});
    clearCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/demo-persona  { persona }  — presentation-only switch
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

// Prompt 15.2 — supplier-admin tenant scoping.
// Returns { scoped: bool, supplierIds: string[], namespaces: string[] }.
// A non-scoped persona (or auth disabled) sees everything.
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

// Middleware: enforce a session on /api/v1/** (except auth/*) when enabled.
export function requireSession(req, res, next) {
  if (!config.auth.enabled) {
    req.identity = { user: "demo", persona: "operator", namespaces: [] };
    return next();
  }
  const openPaths = [/^\/health/, /^\/api\/v1\/auth\//];
  if (openPaths.some((r) => r.test(req.path))) return next();

  const id = readCookie(req);
  if (!id) return res.status(401).json({ error: "authentication required" });
  query(
    `SELECT username, persona, namespaces FROM sessions WHERE id = $1 AND expires_at > now()`,
    [id],
  )
    .then(({ rows }) => {
      if (!rows.length)
        return res.status(401).json({ error: "session expired" });
      req.identity = {
        user: rows[0].username,
        persona: rows[0].persona,
        namespaces: rows[0].namespaces ?? [],
      };
      next();
    })
    .catch(next);
}
