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
import { basename } from "node:path";
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
  dbCredsLeaseId: null,
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
  state.dbCredsLeaseId = creds.lease_id ?? null;
  state.lastDbRotationAt = new Date();
  console.log(
    `[vault] db credentials read from arcanium-vault-agent render (username=${creds.username} ttl=${creds.lease_duration}s)`,
  );

  // Prompt 43 — found live: this used to be watch(TOKEN_PATH, ...) and
  // watch(DB_CREDS_PATH, ...), one fs.watch() per FILE. That fires
  // exactly once, ever, across Agent's atomic write-temp-then-rename
  // update pattern: a watch bound to a specific file is bound to that
  // file's underlying inode, and once the rename swaps in a new inode
  // at the same path, nothing re-arms the watch — Node does not
  // silently resubscribe, and no error is raised either. Confirmed live
  // (arcanium-vault-agent's own logs vs. arcanium-api's own logs, after
  // ~9h uptime): Agent rendered 4 fresh db-creds.json files; arcanium-api
  // picked up exactly the FIRST one and never fired again — eventually
  // the credential it kept using genuinely expired, and every database
  // query, including session sign-in, started failing with a real
  // Postgres auth error. Reproduced in isolation before this fix (a
  // standalone script: 4 renames, watch(FILE_PATH) → 0 events observed)
  // and confirmed the fix below survives the same test (4 renames → every
  // one observed).
  //
  // The fix: watch the CONTAINING DIRECTORY instead of either file. A
  // directory's own inode is not replaced by a rename of one of its
  // entries, so the watch keeps firing indefinitely; dispatch by
  // filename to the same per-file handling either watcher used to do.
  // A directory watch's filename argument is not guaranteed by every
  // platform (Node's own docs) — treat a missing filename as "check
  // both," never as "check neither."
  watch(config.vault.agentSecretsDir, (_eventType, filename) => {
    const name = filename ? basename(String(filename)) : null;
    if (name === null || name === basename(TOKEN_PATH)) {
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
        // Transient: Agent may still be mid-write. Do not flip
        // authenticated to false on a single failed read — the last good
        // in-memory token is still valid until proven otherwise by an
        // actual Vault 403.
        state.lastTokenRefreshError = { at: new Date(), message: err.message };
        console.error(`[vault] token file re-read failed: ${err.message}`);
      }
    }
    if (name === null || name === basename(DB_CREDS_PATH)) {
      (async () => {
        try {
          const next = readDbCredsFile();
          if (next.username === state.dbCreds?.username) return; // same render, no-op
          const { rotateCreds } = await import("./db.js");
          await rotateCreds(next.username, next.password);
          state.dbCreds = { username: next.username, password: next.password };
          state.dbCredsExpiry = new Date(
            Date.now() + next.lease_duration * 1000,
          );
          state.dbCredsLeaseId = next.lease_id ?? null;
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
    }
  });
}

export function getDbCredentials() {
  return state.dbCreds;
}

// Prompt 42 — found live: `/health/ready` used to infer credential
// staleness from dbCredsExpiry (fileWriteTime + lease_duration at the
// moment this file was last read), on the assumption that Agent's
// template re-renders well before the credential actually goes stale.
// That assumption is false — Agent's own lease-renewal loop keeps the
// SAME credential alive by renewing its lease in place, silently, for
// hours; the template only re-renders when Vault issues a genuinely NEW
// credential (a completely different event). Result, confirmed live:
// arcanium-api sat `unhealthy` in `podman ps` for over an hour, with a
// FailingStreak in the hundreds, while every actual database query kept
// succeeding the entire time.
//
// The template already renders `lease_id` (compose/arcanium/vault-agent/
// config.hcl) — previously unused. This asks Vault directly, via
// `sys/leases/lookup`, for the lease's real remaining TTL — the one
// number that actually reflects Agent's background renewals, since
// Agent renews this exact lease_id. Verified live with arcanium-api's
// own real Agent-rendered AppRole token (not root): it already carries
// `sys/leases/*` read via the `arcanium-admin` policy attached to that
// role, so no new Vault grant was needed. Cached briefly to avoid a live
// Vault round-trip on every 15-second readiness poll — same pattern
// suppliers/isolation.js already uses for its own live cross-tenant probe.
const LEASE_TTL_CACHE_MS = 30_000;
let leaseTtlCache = { ttlSeconds: null, checkedAt: 0, error: null };

export async function checkDbLeaseTtl() {
  const leaseId = state.dbCredsLeaseId;
  if (!leaseId) {
    return { ttlSeconds: null, error: "no lease_id on record yet" };
  }
  const now = Date.now();
  if (now - leaseTtlCache.checkedAt < LEASE_TTL_CACHE_MS) {
    return leaseTtlCache;
  }
  try {
    const res = await vaultRequest(
      "PUT",
      "sys/leases/lookup",
      { lease_id: leaseId },
      state.token,
    );
    leaseTtlCache = {
      ttlSeconds: typeof res?.data?.ttl === "number" ? res.data.ttl : null,
      checkedAt: now,
      error: null,
    };
  } catch (err) {
    // Vault unreachable, or the lease genuinely no longer exists — either
    // way this is "could not verify," never "confirmed expiring." The
    // caller (health.js) falls back to the real ping() check rather than
    // fabricating unhealthy from a failed side-check.
    leaseTtlCache = { ttlSeconds: null, checkedAt: now, error: err.message };
  }
  return leaseTtlCache;
}

export function getStatus() {
  return {
    authenticated: state.authenticated,
    tokenExpiry: state.tokenExpiry,
    // Locally-computed estimate only (fileWriteTime + lease_duration at
    // last render) — does NOT reflect Agent's own background lease
    // renewals of the same credential, so it can understate real
    // freshness by hours. Informational for /health's human-facing
    // output; readiness itself uses checkDbLeaseTtl()'s live Vault read.
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

// Prompt 39 — live-verifies a Vault Control Group request's own status,
// distinct from (and never a substitute for) sys/control-group/authorize.
// routes/approvals.js previously flipped an approval's status to
// 'approved' purely on the caller's say-so — nothing ever asked Vault
// whether a real crypto-approvers member had actually authorized this
// accessor. Verified live against a genuine CG-gated request
// (transit/encrypt/external-supplier-key): this endpoint is a
// side-effect-free status read (terraform/vault-platform/policies.tf
// already grants the provisioner token `read` on this exact path — the
// capability was provisioned and unused) — {approved:false,
// authorizations:null} before authorization, {approved:true,
// authorizations:[{entity_id, entity_name}]} after, both HTTP 200. An
// invalid/expired/unknown accessor is a 400, treated the same as any
// other failure here: never read as approved.
export async function checkControlGroupRequest(accessor) {
  try {
    const res = await vaultRequest(
      "POST",
      "sys/control-group/request",
      { accessor },
      getProvisionerToken(),
    );
    return {
      checked: true,
      approved: res?.data?.approved === true,
      authorizations: res?.data?.authorizations ?? null,
    };
  } catch (err) {
    // Any failure — invalid/expired accessor, Vault unreachable — must
    // never be read as "approved". Fail closed.
    return {
      checked: false,
      approved: false,
      authorizations: null,
      error: err.message,
    };
  }
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

// Prompt 37 — was writing with state.token (the general session AppRole
// token), whose policy grants create/update on exactly one path
// (arcanium-webhook-signing — Prompt 28's own exact-path exception), and
// read-only on every other transit key. Verified live: POST /api/v1/keys
// with any name other than that one exception returned a genuine 500 —
// this route was structurally broken for its own stated purpose.
// getProvisionerToken() is what every other key-creation path in this
// codebase already uses (provisioner/application.js, provisioner/key.js).
export async function createTransitKey(name, type = "aes256-gcm96") {
  await vaultRequest(
    "POST",
    `transit/keys/${encodeURIComponent(name)}`,
    { type },
    getProvisionerToken(),
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

// Prompt 32 — namespaced equivalent of getTransitKey(), for supplier-tenant
// keys (suppliers/pepsi, suppliers/cocacola, ...). Same shape of response as
// the root-namespace call, so callers can reuse projectKey()/publicKeyOf()
// unchanged.
export async function getNamespaceTransitKey(namespace, name) {
  const res = await vaultRequestNs(
    "GET",
    `transit/keys/${encodeURIComponent(name)}`,
    null,
    state.token,
    namespace,
  );
  return res.data;
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

/** Read one vault-hsm transit key's metadata. */
export async function getHsmTransitKey(name) {
  const res = await hsmRequest(
    "GET",
    `transit/keys/${encodeURIComponent(name)}`,
  );
  const meta = res.data ?? {};
  // Prompt 37 — previously ran a SEPARATE `LIST sys/managed-keys/pkcs11`
  // and attached `names[0]` — the first managed key returned, entirely
  // uncorrelated to the Transit key actually being read. With more than
  // one managed key registered, every managed_key-type Transit key would
  // display the SAME (wrong) backing key name.
  //
  // First attempted fix assumed Vault's own key metadata would carry a
  // managed_key_name field directly (terraform/vault-managed-keys/
  // transit.tf passes it as a write-time argument) — WRONG, corrected
  // after verifying live: `vault read transit/keys/document-signing-key`
  // exposes no such field at all (checked `.data`'s full key list).
  // There genuinely is no single-call way to correlate a Transit key to
  // its specific backing managed key through Vault's API. The honest fix:
  // when exactly one managed key is registered, there's no real ambiguity
  // to guess at — show it. With more than one, correctly report unknown
  // rather than arbitrarily picking the first (this deployment currently
  // has exactly one, so this shows the real backing key; it degrades to
  // honest "unknown" instead of silently wrong the moment a second one is
  // added, which is a genuine future possibility this fix must survive.
  let managedKeyName = null;
  if (meta.type === "managed_key") {
    try {
      const mk = await hsmRequest("LIST", "sys/managed-keys/pkcs11");
      const names = mk.data?.keys ?? [];
      if (names.length === 1) managedKeyName = names[0];
    } catch {
      /* metadata only — ignore */
    }
  }
  return { ...meta, name, _hsm: true, managed_key_name: managedKeyName };
}

// ── Utilities ──────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
