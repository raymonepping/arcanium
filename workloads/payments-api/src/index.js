// payments-api/src/index.js
// KML stages demonstrated: Gebruik (encrypt/decrypt) + Rotatie (key rotation)

import express  from 'express'
import { createServer } from 'node:http'
import config   from './config.js'
import { init as vaultInit, vaultRequest, getToken, sleep } from './vault.js'

const LABEL = '[payments-api]'

// ── Timers (ms) ──────────────────────────────────────────────────────────
const ENCRYPT_INTERVAL  = 30_000          // encrypt every 30s
const DECRYPT_INTERVAL  = 5 * 60_000      // decrypt round-trip every 5min
const ROTATION_INTERVAL = config.demo.fastRotation
  ? 2 * 60_000      // DEMO_FAST_ROTATION=true:  2 minutes
  : 24 * 60 * 60_000 // production cadence: 24 hours

let lastCiphertext   = null
let currentKeyVersion = 1

// ── Vault operations ───────────────────────────────────────────────────────
async function encrypt(plaintext) {
  const b64 = Buffer.from(JSON.stringify(plaintext)).toString('base64')
  const res  = await vaultRequest('POST', `transit/encrypt/${config.vault.transitKey}`,
    { plaintext: b64 }, getToken())
  return res.data.ciphertext
}

async function decrypt(ciphertext) {
  const res = await vaultRequest('POST', `transit/decrypt/${config.vault.transitKey}`,
    { ciphertext }, getToken())
  return JSON.parse(Buffer.from(res.data.plaintext, 'base64').toString())
}

async function rotateKey() {
  await vaultRequest('POST', `transit/keys/${config.vault.transitKey}/rotate`, null, getToken())
  const meta = await vaultRequest('GET', `transit/keys/${config.vault.transitKey}`, null, getToken())
  currentKeyVersion = meta.data.latest_version
  console.log(`${LABEL} key rotated to version ${currentKeyVersion}`)
}

// ── Behaviour loops ────────────────────────────────────────────────────────
async function encryptLoop() {
  while (true) {
    try {
      const payload   = { card: '4111-1111-1111-1111', ts: new Date().toISOString() }
      lastCiphertext  = await encrypt(payload)
      console.log(`${LABEL} encrypted: ${lastCiphertext.substring(0, 40)}...`)
    } catch (err) {
      console.error(`${LABEL} encrypt error: ${err.message}`)
    }
    await sleep(ENCRYPT_INTERVAL)
  }
}

async function decryptLoop() {
  await sleep(DECRYPT_INTERVAL)  // first decrypt after first rotation window
  while (true) {
    try {
      if (lastCiphertext) {
        const plain = await decrypt(lastCiphertext)
        console.log(`${LABEL} decrypted round-trip OK (card=${plain.card} ts=${plain.ts})`)
      }
    } catch (err) {
      console.error(`${LABEL} decrypt error: ${err.message}`)
    }
    await sleep(DECRYPT_INTERVAL)
  }
}

async function rotationLoop() {
  await sleep(ROTATION_INTERVAL)
  while (true) {
    try {
      await rotateKey()
    } catch (err) {
      console.error(`${LABEL} rotation error: ${err.message}`)
    }
    await sleep(ROTATION_INTERVAL)
  }
}

// ── Health server ──────────────────────────────────────────────────────────
function startHealthServer() {
  const app = express()
  app.disable('x-powered-by')
  app.get('/health', (_req, res) => {
    res.json({
      status:        'ok',
      authenticated: true,
      keyVersion:    currentKeyVersion,
      transitKey:    config.vault.transitKey,
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
  console.log(`${LABEL} starting (fastRotation=${config.demo.fastRotation})`)
  await vaultInit()
  const server = startHealthServer()

  // Run all loops concurrently — errors are caught per-loop
  encryptLoop()
  decryptLoop()
  rotationLoop()

  process.on('SIGTERM', () => { server.close(); process.exit(0) })
  process.on('SIGINT',  () => { server.close(); process.exit(0) })
}

main().catch(err => {
  console.error(`${LABEL} fatal: ${err.message}`)
  process.exit(1)
})
