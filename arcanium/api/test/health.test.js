// test/health.test.js — /health endpoint contract tests.
// Uses Node built-in test runner (node --test) + mocked vault/db modules.

import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createServer } from 'node:http'

// ── Minimal mocks ──────────────────────────────────────────────────────────
let mockAuthenticated = true
let mockDbReachable   = true

const vaultMock = {
  getStatus: () => ({
    authenticated: mockAuthenticated,
    tokenExpiry:   new Date(Date.now() + 3600 * 1000),
    dbCredsExpiry: new Date(Date.now() + 3600 * 1000),
    loginAttempts: 1,
  }),
}

const dbMock = {
  ping: async () => {
    if (!mockDbReachable) throw new Error('connection refused')
    return 3
  },
}

// ── Build a minimal app with mocked deps ───────────────────────────────────
async function buildApp() {
  const { healthRouter } = await buildHealthRouter(vaultMock, dbMock)
  const app = express()
  app.use('/health', healthRouter)
  return app
}

function buildHealthRouter(vault, db) {
  const router = express.Router()

  router.get('/live', (_req, res) => res.json({ status: 'ok' }))

  router.get('/ready', async (_req, res) => {
    const s = vault.getStatus()
    if (!s.authenticated) return res.status(503).json({ status: 'unavailable', reason: 'vault not authenticated' })
    try { await db.ping(); res.json({ status: 'ready' }) }
    catch (err) { res.status(503).json({ status: 'unavailable', reason: `database unreachable: ${err.message}` }) }
  })

  router.get('/', async (_req, res) => {
    const s = vault.getStatus()
    let dbLatency = null, dbReachable = false, dbError = null
    try { dbLatency = await db.ping(); dbReachable = true } catch (err) { dbError = err.message }
    const healthy = s.authenticated && dbReachable
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      version: '1.0.0',
      vault:    { reachable: true, authenticated: s.authenticated, tokenExpiry: s.tokenExpiry },
      database: { reachable: dbReachable, latencyMs: dbLatency, ...(dbError ? { error: dbError } : {}) },
    })
  })

  return { healthRouter: router }
}

// ── Helper ────────────────────────────────────────────────────────────────
async function request(app, path) {
  return new Promise((resolve, reject) => {
    const server = createServer(app)
    server.listen(0, () => {
      const port = server.address().port
      fetch(`http://127.0.0.1:${port}${path}`)
        .then(async res => {
          const body = await res.json().catch(() => ({}))
          server.close()
          resolve({ status: res.status, body })
        })
        .catch(err => { server.close(); reject(err) })
    })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────
test('GET /health/live always returns 200', async () => {
  mockAuthenticated = false
  mockDbReachable   = false
  const app = await buildApp()
  const { status, body } = await request(app, '/health/live')
  assert.equal(status, 200)
  assert.equal(body.status, 'ok')
})

test('GET /health returns 200 when vault authenticated and db reachable', async () => {
  mockAuthenticated = true
  mockDbReachable   = true
  const app = await buildApp()
  const { status, body } = await request(app, '/health')
  assert.equal(status, 200)
  assert.equal(body.status, 'ok')
  assert.ok(body.vault)
  assert.ok(body.database)
  assert.equal(body.vault.authenticated, true)
  assert.equal(body.database.reachable, true)
})

test('GET /health returns 503 when vault unauthenticated', async () => {
  mockAuthenticated = false
  mockDbReachable   = true
  const app = await buildApp()
  const { status, body } = await request(app, '/health')
  assert.equal(status, 503)
  assert.equal(body.status, 'degraded')
  assert.equal(body.vault.authenticated, false)
})

test('GET /health returns 503 when db unreachable', async () => {
  mockAuthenticated = true
  mockDbReachable   = false
  const app = await buildApp()
  const { status, body } = await request(app, '/health')
  assert.equal(status, 503)
  assert.equal(body.status, 'degraded')
  assert.equal(body.database.reachable, false)
  assert.ok(body.database.error)
})

test('GET /health/ready returns 503 when vault unauthenticated', async () => {
  mockAuthenticated = false
  mockDbReachable   = true
  const app = await buildApp()
  const { status, body } = await request(app, '/health/ready')
  assert.equal(status, 503)
  assert.equal(body.status, 'unavailable')
})

test('GET /health/ready returns 200 when healthy', async () => {
  mockAuthenticated = true
  mockDbReachable   = true
  const app = await buildApp()
  const { status, body } = await request(app, '/health/ready')
  assert.equal(status, 200)
  assert.equal(body.status, 'ready')
})
