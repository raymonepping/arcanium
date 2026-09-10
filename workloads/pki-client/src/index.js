// pki-client/src/index.js
// KML stages demonstrated: Generatie + Gebruik + Rotatie (renewal) + Vernietiging (expiry)

import express  from 'express'
import { createServer } from 'node:http'
import config   from './config.js'
import { init as vaultInit, vaultRequest, getToken, sleep } from './vault.js'

const LABEL = '[pki-client]'

// TTL for cert issuance
const CERT_TTL = config.demo.shortTtl ? '2m' : '24h'
const CERT_TTL_MS = config.demo.shortTtl ? 2 * 60_000 : 24 * 60 * 60_000
const CHECK_INTERVAL = 60_000  // renewal check every 60s
const RENEW_THRESHOLD = 0.20   // renew when < 20% TTL remains

let currentCert = null  // { serial, cn, issuedAt, expiresAt, pem }

// ── Parse cert expiry from Vault issue response ────────────────────────────
function parseCertMeta(data) {
  // Vault returns expiration as Unix timestamp
  const expiresAt   = new Date(data.expiration * 1000)
  const issuedAt    = new Date()
  // Extract serial from certificate field (first line after header)
  const serial      = data.serial_number || 'unknown'
  return {
    serial,
    cn:        config.pki.cn,
    issuedAt,
    expiresAt,
    pem:       data.certificate,
  }
}

// ── Issue a certificate ────────────────────────────────────────────────────
async function issueCert() {
  const res = await vaultRequest('POST',
    `${config.pki.mount}/issue/${config.pki.role}`,
    { common_name: config.pki.cn, ttl: CERT_TTL },
    getToken()
  )
  return parseCertMeta(res.data)
}

// ── Renewal loop ───────────────────────────────────────────────────────────
async function renewalLoop() {
  // Issue initial certificate
  try {
    currentCert = await issueCert()
    console.log(`${LABEL} cert issued serial=${currentCert.serial} cn=${currentCert.cn} expires=${currentCert.expiresAt.toISOString()}`)
  } catch (err) {
    console.error(`${LABEL} initial cert issue failed: ${err.message}`)
    process.exit(1)
  }

  while (true) {
    await sleep(CHECK_INTERVAL)
    try {
      const now       = Date.now()
      const expiresMs = currentCert.expiresAt.getTime()
      const remaining = expiresMs - now
      const threshold = CERT_TTL_MS * RENEW_THRESHOLD

      if (remaining < threshold) {
        const newCert = await issueCert()
        console.log(`${LABEL} cert renewed serial=${newCert.serial} cn=${newCert.cn} expires=${newCert.expiresAt.toISOString()} (previous serial=${currentCert.serial} was expiring in ${Math.round(remaining / 1000)}s)`)
        currentCert = newCert
      } else {
        console.log(`${LABEL} cert valid serial=${currentCert.serial} ttl_remaining=${Math.round(remaining / 1000)}s`)
      }
    } catch (err) {
      console.error(`${LABEL} renewal check error: ${err.message}`)
    }
  }
}

// ── Health server ──────────────────────────────────────────────────────────
function startHealthServer() {
  const app = express()
  app.disable('x-powered-by')

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', authenticated: true })
  })

  app.get('/cert', (_req, res) => {
    if (!currentCert) return res.status(503).json({ error: 'no certificate yet' })
    const remaining = Math.max(0, currentCert.expiresAt.getTime() - Date.now())
    res.json({
      serial:       currentCert.serial,
      cn:           currentCert.cn,
      issuedAt:     currentCert.issuedAt.toISOString(),
      expiresAt:    currentCert.expiresAt.toISOString(),
      ttlRemaining: `${Math.round(remaining / 1000)}s`,
    })
  })

  const server = createServer(app)
  server.listen(config.port, () => {
    console.log(`${LABEL} health server on port ${config.port}`)
  })
  return server
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${LABEL} starting (shortTtl=${config.demo.shortTtl} certTtl=${CERT_TTL})`)
  await vaultInit()
  const server = startHealthServer()

  renewalLoop()

  process.on('SIGTERM', () => { server.close(); process.exit(0) })
  process.on('SIGINT',  () => { server.close(); process.exit(0) })
}

main().catch(err => {
  console.error(`${LABEL} fatal: ${err.message}`)
  process.exit(1)
})
