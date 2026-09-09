// routes/keys.js — Transit key inventory and creation.

import { Router }          from 'express'
import { listTransitKeys, getTransitKey, createTransitKey } from '../vault.js'

export const keysRouter = Router()

const ALLOWED_TYPES = new Set(['aes256-gcm96', 'rsa-2048', 'rsa-4096', 'ecdsa-p256'])
const NAME_RE       = /^[a-z0-9_-]{1,128}$/i

// GET /api/v1/keys
keysRouter.get('/', async (_req, res, next) => {
  try {
    const names = await listTransitKeys()
    // Fetch metadata for each key concurrently (Transit keys are usually few)
    const keys = await Promise.all(names.map(async name => {
      try {
        const meta = await getTransitKey(name)
        return {
          name,
          type:                  meta.type,
          versions:              meta.latest_version,
          min_decryption_version: meta.min_decryption_version,
        }
      } catch {
        return { name, type: 'unknown', versions: null, min_decryption_version: null }
      }
    }))
    res.json(keys)
  } catch (err) { next(err) }
})

// GET /api/v1/keys/:name
keysRouter.get('/:name', async (req, res, next) => {
  try {
    const meta = await getTransitKey(req.params.name)
    res.json(meta)
  } catch (err) {
    if (err.vaultStatus === 404) {
      const e = new Error('key not found'); e.status = 404; return next(e)
    }
    next(err)
  }
})

// POST /api/v1/keys
keysRouter.post('/', async (req, res, next) => {
  try {
    const { name, type = 'aes256-gcm96' } = req.body ?? {}
    if (!name)              return res.status(400).json({ error: 'name is required', field: 'name' })
    if (!NAME_RE.test(name)) return res.status(400).json({ error: 'invalid key name', field: 'name' })
    if (!ALLOWED_TYPES.has(type))
      return res.status(400).json({ error: `type must be one of: ${[...ALLOWED_TYPES].join(', ')}`, field: 'type' })

    const result = await createTransitKey(name, type)
    res.status(201).json(result)
  } catch (err) { next(err) }
})
