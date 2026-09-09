// db.js — PostgreSQL connection pool with dynamic credential rotation.
// Credentials are supplied by vault.js; never read from env directly.

import pg     from 'pg'
import config from './config.js'

const { Pool } = pg

let pool = null

function makePool(username, password) {
  return new Pool({
    host:                   config.postgres.host,
    port:                   config.postgres.port,
    database:               config.postgres.db,
    user:                   username,
    password:               password,
    max:                    5,
    idleTimeoutMillis:      30000,
    connectionTimeoutMillis: 5000,
  })
}

// Called by vault.js after fetching the first set of credentials.
export function init(username, password) {
  pool = makePool(username, password)
  pool.on('error', err => {
    console.error('[db] idle client error:', err.message)
  })
  console.log(`[db] pool created (user=${username})`)
}

// Called by vault.js when DB credentials are rotated.
export async function rotateCreds(username, password) {
  const old = pool
  pool = makePool(username, password)
  pool.on('error', err => {
    console.error('[db] idle client error:', err.message)
  })
  console.log(`[db] pool rotated (user=${username})`)
  // Drain old pool gracefully — in-flight queries finish normally
  if (old) await old.end().catch(err => console.error('[db] error draining old pool:', err.message))
}

// Thin query wrapper — re-throws with query text in message for internal logs.
export async function query(text, params) {
  if (!pool) throw new Error('[db] pool not initialised')
  try {
    return await pool.query(text, params)
  } catch (err) {
    throw Object.assign(new Error(`[db] query failed: ${err.message} | sql: ${text}`), { code: err.code })
  }
}

// Ping the database — used by the health endpoint.
export async function ping() {
  const start = Date.now()
  await query('SELECT 1')
  return Date.now() - start
}

export function getPool() { return pool }
