// db.js — PostgreSQL connection pool with dynamic credential rotation.
// Credentials are supplied by vault.js; never read from env directly.

import pg from "pg";
import config from "./config.js";

const { Pool } = pg;

let pool = null;

function makePool(username, password) {
  return new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.db,
    user: username,
    password: password,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

// Called by vault.js after fetching the first set of credentials.
export function init(username, password) {
  pool = makePool(username, password);
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });
  console.log(`[db] pool created (user=${username})`);
}

// Called by vault.js when DB credentials are rotated.
export async function rotateCreds(username, password) {
  const old = pool;
  pool = makePool(username, password);
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });
  console.log(`[db] pool rotated (user=${username})`);
  // Drain old pool gracefully — in-flight queries finish normally
  if (old)
    await old
      .end()
      .catch((err) =>
        console.error("[db] error draining old pool:", err.message),
      );
}

// Thin query wrapper — re-throws with query text in message for internal logs.
export async function query(text, params) {
  if (!pool) throw new Error("[db] pool not initialised");
  try {
    return await pool.query(text, params);
  } catch (err) {
    throw Object.assign(
      new Error(`[db] query failed: ${err.message} | sql: ${text}`),
      { code: err.code },
    );
  }
}

// Prompt 36 — a real transaction, unlike calling query("BEGIN")/query(...)/
// query("COMMIT") separately: query() is pool.query(), which checks a
// connection out of the pool and returns it after EVERY single call —
// there is no guarantee any two of those calls land on the same
// connection. A BEGIN on one connection, a FOR UPDATE on another, is not
// a transaction at all: the lock protects nothing, and a stray BEGIN can
// leave a pooled connection sitting open-in-transaction indefinitely.
// withTransaction() holds one client for the whole callback and always
// releases it — the only way BEGIN/…/COMMIT are ever actually atomic.
// getPool() is read fresh (not a module-load-time reference) so this
// keeps working correctly across a rotateCreds() pool swap.
export async function withTransaction(fn) {
  const p = getPool();
  if (!p) throw new Error("[db] pool not initialised");
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Prompt 39 — escapes LIKE metacharacters (`\`, `%`, `_`) in a value that
// is meant to be matched LITERALLY inside a LIKE pattern that also needs a
// genuine wildcard elsewhere (e.g. a trailing `%`). Postgres's default LIKE
// escape character is the backslash, so this alone is sufficient — but
// callers should still add an explicit `ESCAPE '\'` clause, since relying
// on an unstated default is exactly the kind of implicit behavior this
// project's own discipline avoids. Most "does X end with Y" checks in this
// codebase don't actually need wildcard semantics at all — those should
// use `right(a, length(b)+1) = '/' || b` instead of LIKE, which has no
// metacharacter surface to escape in the first place; this helper is only
// for the few call sites (aggregation/intent.js's scope prefix match) that
// genuinely need a real wildcard alongside a literal, untrusted value.
export function escapeLikeValue(value) {
  return String(value).replace(/[\\%_]/g, (ch) => "\\" + ch);
}

// Ping the database — used by the health endpoint.
export async function ping() {
  const start = Date.now();
  await query("SELECT 1");
  return Date.now() - start;
}

export function getPool() {
  return pool;
}
