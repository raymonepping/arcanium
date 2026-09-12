// vault.js — Vault API client.
// Handles AppRole login, token refresh, and dynamic DB credential rotation.
// Uses Node 22 native https module — no SDK dependency.

import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import config from "./config.js";

// ── Custom CA cert ─────────────────────────────────────────────────────────
let _ca;
function getCa() {
  if (!_ca) _ca = readFileSync(config.vault.cacert);
  return _ca;
}

// Prompt 21 — found live while proving "Vault briefly unreachable yields
// UNKNOWN quickly": none of these request helpers set a socket timeout, so
// a network partition (no RST, no ICMP unreachable — exactly what a
// disconnected podman network produces) hangs until the OS's own TCP
// connect timeout, which can be well over a minute. That's not "briefly
// unreachable, degrades gracefully" — it's an API request that appears to
// hang. A bounded timeout turns a silent hang into a fast, honest error,
// which every caller already treats as UNKNOWN (never fabricated as PASS).
const REQUEST_TIMEOUT_MS = 5000;
function armTimeout(req, method, path) {
  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    req.destroy(
      new Error(
        `Vault ${method} ${path} → timed out after ${REQUEST_TIMEOUT_MS}ms`,
      ),
    );
  });
}

// ── Core HTTP helper ───────────────────────────────────────────────────────
function vaultRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/v1/${path}`, config.vault.addr);
    const data = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-Vault-Token"] = token;
    if (data) headers["Content-Length"] = Buffer.byteLength(data);

    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        ca: getCa(),
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(
              `Vault ${method} ${path} → ${res.statusCode}: ${text}`,
            );
            err.vaultStatus = res.statusCode;
            return reject(err);
          }
          const ct = res.headers["content-type"] || "";
          try {
            resolve(ct.includes("application/json") ? JSON.parse(text) : text);
          } catch (e) {
            resolve(text);
          }
        });
      },
    );

    armTimeout(req, method, path);
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Export the raw request helper so routes can make arbitrary Vault calls.
export { vaultRequest };

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  authenticated: false,
  token: null,
  tokenExpiry: null,
  dbCreds: null,
  dbCredsExpiry: null,
  loginAttempts: 0,
  refreshTimer: null,
  dbRotateTimer: null,
};

// ── AppRole login with exponential backoff ─────────────────────────────────
async function login() {
  const delays = [1000, 2000, 4000, 8000, 16000];
  let lastErr;
  for (let i = 0; i < delays.length; i++) {
    state.loginAttempts = i + 1;
    try {
      const res = await vaultRequest("POST", "auth/approle/login", {
        role_id: config.vault.roleId,
        secret_id: config.vault.secretId,
      });
      const { client_token, lease_duration } = res.auth;
      state.token = client_token;
      state.tokenExpiry = new Date(Date.now() + lease_duration * 1000);
      state.authenticated = true;
      console.log(
        `[vault] authenticated (ttl=${lease_duration}s attempt=${i + 1})`,
      );
      scheduleTokenRefresh(lease_duration);
      return;
    } catch (err) {
      lastErr = err;
      console.error(`[vault] login attempt ${i + 1} failed: ${err.message}`);
      if (i < delays.length - 1) await sleep(delays[i]);
    }
  }
  throw new Error(
    `[vault] login exhausted after ${delays.length} attempts: ${lastErr.message}`,
  );
}

function scheduleTokenRefresh(ttlSeconds) {
  clearTimeout(state.refreshTimer);
  const delay = Math.floor(ttlSeconds * 0.8) * 1000;
  state.refreshTimer = setTimeout(async () => {
    console.log("[vault] refreshing token...");
    try {
      await login();
    } catch (err) {
      console.error(`[vault] token refresh failed: ${err.message}`);
      state.authenticated = false;
    }
  }, delay);
  state.refreshTimer.unref();
}

// ── Dynamic DB credentials ─────────────────────────────────────────────────
async function fetchDbCredentials() {
  const res = await vaultRequest(
    "GET",
    "database/creds/arcanium-api-role",
    null,
    state.token,
  );
  const { username, password } = res.data;
  const leaseDuration = res.lease_duration;
  state.dbCreds = { username, password };
  state.dbCredsExpiry = new Date(Date.now() + leaseDuration * 1000);
  console.log(
    `[vault] db credentials obtained (username=${username} ttl=${leaseDuration}s)`,
  );
  scheduleDbCredsRotation(leaseDuration);
  return { username, password, lease_duration: leaseDuration };
}

function scheduleDbCredsRotation(leaseDuration) {
  clearTimeout(state.dbRotateTimer);
  const delay = Math.floor(leaseDuration * 0.75) * 1000;
  state.dbRotateTimer = setTimeout(async () => {
    console.log("[vault] rotating db credentials...");
    try {
      const creds = await fetchDbCredentials();
      const { rotateCreds } = await import("./db.js");
      await rotateCreds(creds.username, creds.password);
      console.log("[vault] db credentials rotated successfully");
    } catch (err) {
      console.error(`[vault] db creds rotation failed: ${err.message}`);
    }
  }, delay);
  state.dbRotateTimer.unref();
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function init() {
  await login();
  await fetchDbCredentials();
}

export function getDbCredentials() {
  return state.dbCreds;
}

export function getStatus() {
  return {
    authenticated: state.authenticated,
    tokenExpiry: state.tokenExpiry,
    dbCredsExpiry: state.dbCredsExpiry,
    loginAttempts: state.loginAttempts,
  };
}

// Return the current Vault token (used by routes that call Vault directly).
export function getToken() {
  return state.token;
}

// Token for provisioning writes. Prefers VAULT_PROVISIONER_TOKEN (needed for
// cross-namespace operations); falls back to the AppRole token (root ns only).
export function getProvisionerToken() {
  return config.vault.provisionerToken || state.token;
}

export async function listTransitKeys() {
  const res = await vaultRequest("LIST", "transit/keys", null, state.token);
  return res.data?.keys ?? [];
}

export async function getTransitKey(name) {
  const res = await vaultRequest(
    "GET",
    `transit/keys/${encodeURIComponent(name)}`,
    null,
    state.token,
  );
  return res.data;
}

export async function createTransitKey(name, type = "aes256-gcm96") {
  await vaultRequest(
    "POST",
    `transit/keys/${encodeURIComponent(name)}`,
    { type },
    state.token,
  );
  return { name, type };
}

// Prompt 28, Deliverable 3 — webhook signing secrets need to be genuinely
// reversible (Arcanium computes an HMAC signature with them on every
// outgoing delivery, unlike a service-account token, which is only ever
// verified by comparing hashes). A dedicated Transit key, encrypted at
// rest, same discipline every other stored secret in this codebase already
// uses — never a home-rolled reversible scheme. Lazily created on first use.
const WEBHOOK_SIGNING_KEY = "arcanium-webhook-signing";

async function ensureWebhookSigningKey() {
  try {
    await getTransitKey(WEBHOOK_SIGNING_KEY);
  } catch (err) {
    if (err.vaultStatus === 404) {
      await createTransitKey(WEBHOOK_SIGNING_KEY, "aes256-gcm96");
    } else {
      throw err;
    }
  }
}

export async function encryptWebhookSecret(plaintext) {
  await ensureWebhookSigningKey();
  const res = await vaultRequest(
    "POST",
    `transit/encrypt/${WEBHOOK_SIGNING_KEY}`,
    { plaintext: Buffer.from(plaintext, "utf8").toString("base64") },
    state.token,
  );
  return res.data.ciphertext;
}

export async function decryptWebhookSecret(ciphertext) {
  const res = await vaultRequest(
    "POST",
    `transit/decrypt/${WEBHOOK_SIGNING_KEY}`,
    { ciphertext },
    state.token,
  );
  return Buffer.from(res.data.plaintext, "base64").toString("utf8");
}

export async function getPkiCaChain() {
  return vaultRequest("GET", "pki-int/ca/pem", null, state.token);
}

export async function listPkiRoles() {
  try {
    const res = await vaultRequest("LIST", "pki-int/roles", null, state.token);
    return res.data?.keys ?? [];
  } catch (err) {
    if (err.vaultStatus === 404) return [];
    throw err;
  }
}

// ── Namespace-scoped Vault requests ───────────────────────────────────────
// Used by supplier routes to query keys in a supplier's Vault namespace.
function vaultRequestNs(method, path, body, token, namespace) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/v1/${path}`, config.vault.addr);
    const data = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-Vault-Token"] = token;
    if (namespace) headers["X-Vault-Namespace"] = namespace;
    if (data) headers["Content-Length"] = Buffer.byteLength(data);

    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        ca: getCa(),
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(
              `Vault ${method} ${path} (ns=${namespace}) → ${res.statusCode}: ${text}`,
            );
            err.vaultStatus = res.statusCode;
            return reject(err);
          }
          const ct = res.headers["content-type"] || "";
          try {
            resolve(ct.includes("application/json") ? JSON.parse(text) : text);
          } catch (e) {
            resolve(text);
          }
        });
      },
    );
    armTimeout(req, method, path);
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Exported for the provisioner (Prompt 14.2): arbitrary namespace-scoped calls.
export { vaultRequestNs };

export async function listNamespaceTransitKeys(namespace) {
  try {
    const res = await vaultRequestNs(
      "LIST",
      "transit/keys",
      null,
      state.token,
      namespace,
    );
    return res.data?.keys ?? [];
  } catch (err) {
    if (err.vaultStatus === 404) return [];
    throw err;
  }
}

// ── vault-hsm read client (Prompt 14.1 — Managed Key custody) ──────────────
// A separate, read-only AppRole session against vault-hsm so the API can show
// the SoftHSM-backed document-signing-key in the inventory with correct custody.
// Never used for crypto operations — list + read metadata only.
const hsmState = { token: null, expiry: 0 };

function hsmHttp(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/v1/${path}`, config.hsm.addr);
    const data = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-Vault-Token"] = token;
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        ca: getCa(),
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(
              `vault-hsm ${method} ${path} → ${res.statusCode}`,
            );
            err.vaultStatus = res.statusCode;
            return reject(err);
          }
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch {
            resolve(text);
          }
        });
      },
    );
    armTimeout(req, method, path);
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function hsmLogin() {
  const res = await hsmHttp("POST", "auth/approle/login", {
    role_id: config.hsm.roleId,
    secret_id: config.hsm.secretId,
  });
  hsmState.token = res.auth.client_token;
  hsmState.expiry =
    Date.now() + (res.auth.lease_duration ?? 3600) * 1000 - 60000;
}

async function hsmRequest(method, path) {
  if (!config.hsm.enabled) throw new Error("vault-hsm client not configured");
  if (!hsmState.token || Date.now() > hsmState.expiry) await hsmLogin();
  try {
    return await hsmHttp(method, path, null, hsmState.token);
  } catch (err) {
    if (err.vaultStatus === 403) {
      await hsmLogin();
      return hsmHttp(method, path, null, hsmState.token);
    }
    throw err;
  }
}

/** List transit keys held on vault-hsm. Returns [] if the client is disabled/unreachable. */
export async function listHsmTransitKeys() {
  if (!config.hsm.enabled) return [];
  try {
    const res = await hsmRequest("LIST", "transit/keys");
    return res.data?.keys ?? [];
  } catch {
    return [];
  }
}

/** Read one vault-hsm transit key's metadata, enriched with its managed-key backing. */
export async function getHsmTransitKey(name) {
  const res = await hsmRequest(
    "GET",
    `transit/keys/${encodeURIComponent(name)}`,
  );
  const meta = res.data ?? {};
  let managedKey = null;
  if (meta.type === "managed_key") {
    try {
      const mk = await hsmRequest("LIST", "sys/managed-keys/pkcs11");
      const names = mk.data?.keys ?? [];
      // Best-effort: attach the first pkcs11 managed key's details for display.
      if (names.length) {
        const detail = await hsmRequest(
          "GET",
          `sys/managed-keys/pkcs11/${encodeURIComponent(names[0])}`,
        );
        managedKey = { name: names[0], ...(detail.data ?? {}) };
      }
    } catch {
      /* metadata only — ignore */
    }
  }
  return { ...meta, name, _hsm: true, _managedKey: managedKey };
}

// ── Utilities ──────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
