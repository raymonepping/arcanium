// index.js — Express application entry point.
// Startup is fail-fast: any error before server.listen exits with code 1.

import express  from 'express'
import { createServer } from 'node:http'

import config from './config.js'
import { init as vaultInit, getDbCredentials } from './vault.js'
import { init as dbInit } from './db.js'
import { runMigrations } from './migrations.js'

import { requestLogger } from './middleware/requestLogger.js'
import { errorHandler }  from './middleware/errorHandler.js'
import { healthRouter }  from './routes/health.js'
import { applicationsRouter } from './routes/applications.js'
import { keysRouter }    from './routes/keys.js'
import { pkiRouter }     from './routes/pki.js'

async function main() {
  // 1. Vault: AppRole login + first DB credentials
  console.log('[startup] initialising Vault client...')
  await vaultInit()

  // 2. Database pool: init with credentials from Vault
  console.log('[startup] initialising database pool...')
  const { username, password } = getDbCredentials()
  dbInit(username, password)

  // 3. Migrations
  console.log('[startup] running migrations...')
  await runMigrations()

  // 4. Build Express app
  const app = express()
  app.set('trust proxy', false)
  app.disable('x-powered-by')

  app.use(express.json({ limit: '100kb' }))
  app.use(requestLogger)

  app.use('/health',          healthRouter)
  app.use('/api/v1/applications', applicationsRouter)
  app.use('/api/v1/keys',     keysRouter)
  app.use('/api/v1/pki',      pkiRouter)

  // 404 for unknown routes
  app.use((_req, res) => res.status(404).json({ error: 'not found' }))

  // Global error handler (must be last)
  app.use(errorHandler)

  // 5. Start listening
  const server = createServer(app)
  await new Promise(resolve => server.listen(config.port, resolve))
  console.log(`[startup] arcanium-api listening on port ${config.port} (${config.nodeEnv})`)

  // 6. Graceful shutdown
  function shutdown(signal) {
    console.log(`[shutdown] received ${signal}, draining connections...`)
    server.close(async () => {
      const { getPool } = await import('./db.js')
      const pool = getPool()
      if (pool) await pool.end().catch(() => {})
      console.log('[shutdown] clean exit')
      process.exit(0)
    })
    // Force exit if drain takes too long
    setTimeout(() => { console.error('[shutdown] timeout — forced exit'); process.exit(1) }, 10000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

main().catch(err => {
  console.error('[startup] fatal error:', err.message)
  process.exit(1)
})
