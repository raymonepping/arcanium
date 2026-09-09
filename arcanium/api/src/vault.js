// vault.js — Vault API client.
// Handles AppRole login, token refresh, and dynamic DB credential rotation.
// Uses Node 22 native https module — no SDK dependency.

import { readFileSync }   from 'node:fs'
import { request as httpsRequest } from 'node:https'
import config             from './config.js'

// ── Custom CA cert ─────────────────────────────────────────────────────────
let _ca
function getCa() {
  if (!_ca) _ca = readFileSync(config.vault.cacert)
  return _ca
}

// ── Core HTTP helper ───────────────────────────────────────────────────────
function vaultRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url    = new URL(`/v1/${path}`, config.vault.addr)
    const data   = body ? JSON.stringify(body) : null
    const headers = { 'Content-Type': 'application/json' }
    if (token)  headers['X-Vault-Token'] = token
    if (data)   headers['Content-Length'] = Buffer.byteLength(data)

    const req = httpsRequest({
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname + url.search,
      method,
      headers,
      ca:       getCa(),
      rejectUnauthorized: true,
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString()
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`Vault ${method} ${path} → ${res.statusCode}: ${text}`)
          err.vaultStatus = res.statusCode
          return reject(err)
        }
        const ct = res.headers['content-type'] || ''
        try {
          resolve(ct.includes('application/json') ? JSON.parse(text) : text)
        } catch (e) {
          resolve(text)
        }
      })
    })

    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  authenticated:  false,
  token:          null,
  tokenExpiry:    null,
  dbCreds:        null,
  dbCredsExpiry:  null,
  loginAttempts:  0,
  refreshTimer:   null,
  dbRotateTimer:  null,
}

// ── AppRole login with exponential backoff ─────────────────────────────────
async function login() {
  const delays = [1000, 2000, 4000, 8000, 16000]
  let lastErr
  for (let i = 0; i < delays.length; i++) {
    state.loginAttempts = i + 1
    try {
      const res = await vaultRequest('POST', 'auth/approle/login', {
        role_id:   config.vault.roleId,
        secret_id: config.vault.secretId,
      })
      const { client_token, lease_duration } = res.auth
      state.token         = client_token
      state.tokenExpiry   = new Date(Date.now() + lease_duration * 1000)
      state.authenticated = true
      console.log(`[vault] authenticated (ttl=${lease_duration}s attempt=${i + 1})`)
      scheduleTokenRefresh(lease_duration)
      return
    } catch (err) {
      lastErr = err
      console.error(`[vault] login attempt ${i + 1} failed: ${err.message}`)
      if (i < delays.length - 1) await sleep(delays[i])
    }
  }
  throw new Error(`[vault] login exhausted after ${delays.length} attempts: ${lastErr.message}`)
}

function scheduleTokenRefresh(ttlSeconds) {
  clearTimeout(state.refreshTimer)
  const delay = Math.floor(ttlSeconds * 0.8) * 1000
  state.refreshTimer = setTimeout(async () => {
    console.log('[vault] refreshing token...')
    try { await login() }
    catch (err) {
      console.error(`[vault] token refresh failed: ${err.message}`)
      state.authenticated = false
    }
  }, delay)
  state.refreshTimer.unref()
}

// ── Dynamic DB credentials ─────────────────────────────────────────────────
async function fetchDbCredentials() {
  const res = await vaultRequest('GET', 'database/creds/arcanium-api-role', null, state.token)
  const { username, password } = res.data
  const leaseDuration          = res.lease_duration
  state.dbCreds       = { username, password }
  state.dbCredsExpiry = new Date(Date.now() + leaseDuration * 1000)
  console.log(`[vault] db credentials obtained (username=${username} ttl=${leaseDuration}s)`)
  scheduleDbCredsRotation(leaseDuration)
  return { username, password, lease_duration: leaseDuration }
}

function scheduleDbCredsRotation(leaseDuration) {
  clearTimeout(state.dbRotateTimer)
  const delay = Math.floor(leaseDuration * 0.75) * 1000
  state.dbRotateTimer = setTimeout(async () => {
    console.log('[vault] rotating db credentials...')
    try {
      const creds = await fetchDbCredentials()
      const { rotateCreds } = await import('./db.js')
      await rotateCreds(creds.username, creds.password)
      console.log('[vault] db credentials rotated successfully')
    } catch (err) {
      console.error(`[vault] db creds rotation failed: ${err.message}`)
    }
  }, delay)
  state.dbRotateTimer.unref()
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function init() {
  await login()
  await fetchDbCredentials()
}

export function getDbCredentials() { return state.dbCreds }

export function getStatus() {
  return {
    authenticated: state.authenticated,
    tokenExpiry:   state.tokenExpiry,
    dbCredsExpiry: state.dbCredsExpiry,
    loginAttempts: state.loginAttempts,
  }
}

export async function listTransitKeys() {
  const res = await vaultRequest('LIST', 'transit/keys', null, state.token)
  return res.data?.keys ?? []
}

export async function getTransitKey(name) {
  const res = await vaultRequest('GET', `transit/keys/${encodeURIComponent(name)}`, null, state.token)
  return res.data
}

export async function createTransitKey(name, type = 'aes256-gcm96') {
  await vaultRequest('POST', `transit/keys/${encodeURIComponent(name)}`, { type }, state.token)
  return { name, type }
}

export async function getPkiCaChain() {
  return vaultRequest('GET', 'pki-int/ca/pem', null, state.token)
}

export async function listPkiRoles() {
  try {
    const res = await vaultRequest('LIST', 'pki-int/roles', null, state.token)
    return res.data?.keys ?? []
  } catch (err) {
    if (err.vaultStatus === 404) return []
    throw err
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
