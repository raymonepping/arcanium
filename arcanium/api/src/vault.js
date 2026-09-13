// vault.js — Vault API client.
//
// Prompt 30 — AppRole auto-auth and dynamic-DB-credential rotation are no
// longer this file's problem. arcanium-vault-agent (compose/arcanium/
// vault-agent/) owns both: it authenticates on its own schedule/retry
// logic (HashiCorp's own, not ours) and renders a current token +
// database/creds/arcanium-api-role credential to a shared volume. This
// file just reads what Agent already wrote, and reacts when those files
// change. Prompt 29 hand-rolled a retry-with-backoff fix for the exact
// failure this replaces (a dead-end retry chain that silently killed
// rotation) — this prompt removes the need for this project to own that
// correctness problem at all.
//
// Every direct Vault API call this file still makes on the app's own
// behalf (Transit, PKI, Control Group, vault-hsm) is UNCHANGED — Agent is
// not a proxy for those, it only owns auth + the one credential above.

import { readFileSync, watch } from "node:fs";
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
  token: null,
  dbCreds: null,
  dbCredsExpiry: null,
  // Prompt 30 — "authenticated" now means "we have successfully read a
  // non-empty token from Agent's sink file at least once," not "this
  // process itself completed an AppRole login." tokenExpiry/loginAttempts
  // are no longer knowable from this file (Agent never writes lease
  // metadata into the sink file, only the raw token) — left as documented,
  // honest nulls rather than fabricated.
  authenticated: false,
  tokenExpiry: null,
  loginAttempts: null,
  // Last time each watched file was successfully read+parsed (renamed
  // conceptually from Prompt 29's "last rotation succeeded" — same shape,
  // same health.js consumer, now observing Agent's writes instead of our
  // own rotation loop). *Error fields are for OUR read/parse failures
  // (a malformed or transiently-unreadable file) — Agent's own internal
  // auth/render retry state is not observable from here, by design; that
  // is the whole point of moving this responsibility to Agent.
  lastDbRotationAt: null,
  lastDbRotationError: null,
  lastTokenRefreshAt: null,
  lastTokenRefreshError: null,
};

const TOKEN_PATH = `${config.vault.agentSecretsDir}/token`;
const DB_CREDS_PATH = `${config.vault.agentSecretsDir}/db-creds.json`;

function readTokenFile() {
  const text = readFileSync(TOKEN_PATH, "utf8").trim();
  if (!text) throw new Error(`${TOKEN_PATH} is empty`);
  return text;
}

function readDbCredsFile() {
  const text = readFileSync(DB_CREDS_PATH, "utf8").trim();
  if (!text) throw new Error(`${DB_CREDS_PATH} is empty`);
  const parsed = JSON.parse(text); // throws on a partial/mid-write read — caller retries
  if (!parsed.username || !parsed.password) {
    throw new Error(`${DB_CREDS_PATH} missing username/password`);
  }
  return parsed;
}

// Bounded wait for Agent's first successful auth/render on container
// startup — Agent may still be authenticating for the first time when
// this process starts. This is a one-time startup gate, not an ongoing
// background loop, so it cannot silently die the way Prompt 29's
// schedulers could: init() either succeeds within the deadline or throws,
// and index.js/worker.js already treat init() throwing as a fatal startup
// error (unchanged from before this prompt).
async function waitForFile(path, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      readFileSync(path, "utf8");
      return;
    } catch (err) {
      lastErr = err;
      await sleep(500);
    }
  }
  throw new Error(
    `[vault] timed out waiting for ${label} (${path}) after ${timeoutMs}ms — is arcanium-vault-agent running and authenticated? last error: ${lastErr?.message}`,
  );
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function init() {
  await waitForFile(TOKEN_PATH, "Agent token sink");
  await waitForFile(DB_CREDS_PATH, "Agent DB-credential render");

  state.token = readTokenFile();
  state.authenticated = true;
  state.lastTokenRefreshAt = new Date();
  console.log("[vault] token read from arcanium-vault-agent sink");

  const creds = readDbCredsFile();
  state.dbCreds = { username: creds.username, password: creds.password };
  state.dbCredsExpiry = new Date(Date.now() + creds.lease_duration * 1000);
  state.lastDbRotationAt = new Date();
  console.log(
    `[vault] db credentials read from arcanium-vault-agent render (username=${creds.username} ttl=${creds.lease_duration}s)`,
  );

  // fs.watch's "rename" vs "change" event semantics differ across
  // filesystems/bind-mount types — Agent renders atomically via a
  // temp-file-then-rename, which some drivers surface as "rename," not
  // "change." React to either; re-reading an unchanged file is a harmless
  // no-op, and missing a real change is the failure mode actually worth
  // avoiding here.
  watch(TOKEN_PATH, () => {
    try {
      const next = readTokenFile();
      if (next !== state.token) {
        state.token = next;
        state.authenticated = true;
        state.lastTokenRefreshAt = new Date();
        state.lastTokenRefreshError = null;
        console.log("[vault] token file changed — picked up new token");
      }
    } catch (err) {
      // Transient: Agent may still be mid-write. Do not flip authenticated
      // to false on a single failed read — the last good in-memory token
      // is still valid until proven otherwise by an actual Vault 403.
      state.lastTokenRefreshError = { at: new Date(), message: err.message };
      console.error(`[vault] token file re-read failed: ${err.message}`);
    }
  });

  watch(DB_CREDS_PATH, () => {
    (async () => {
      try {
        const next = readDbCredsFile();
        if (next.username === state.dbCreds?.username) return; // same render, no-op
        const { rotateCreds } = await import("./db.js");
        await rotateCreds(next.username, next.password);
        state.dbCreds = { username: next.username, password: next.password };
        state.dbCredsExpiry = new Date(Date.now() + next.lease_duration * 1000);
        state.lastDbRotationAt = new Date();
        state.lastDbRotationError = null;
        console.log(
          `[vault] db-creds file changed — pool rotated (user=${next.username})`,
        );
      } catch (err) {
        state.lastDbRotationError = { at: new Date(), message: err.message };
        console.error(
          `[vault] db-creds file re-read/rotate failed: ${err.message}`,
        );
      }
    })();
  });
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
    lastDbRotationAt: state.lastDbRotationAt,
    lastDbRotationError: state.lastDbRotationError,
    lastTokenRefreshAt: state.lastTokenRefreshAt,
    lastTokenRefreshError: state.lastTokenRefreshError,
    // Prompt 30 — makes the architecture change visible in /health output
    // itself, not silently identical-looking JSON from a totally different
    // mechanism underneath.
    agentManaged: true,
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
