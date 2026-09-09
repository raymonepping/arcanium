// routes/pki.js — PKI CA chain and role inventory.

import { Router }                    from 'express'
import { getPkiCaChain, listPkiRoles } from '../vault.js'

export const pkiRouter = Router()

// GET /api/v1/pki/ca-chain
pkiRouter.get('/ca-chain', async (_req, res, next) => {
  try {
    const pem = await getPkiCaChain()
    res.set('Content-Type', 'text/plain').send(pem)
  } catch (err) { next(err) }
})

// GET /api/v1/pki/roles
pkiRouter.get('/roles', async (_req, res, next) => {
  try {
    const roles = await listPkiRoles()
    res.json(roles)
  } catch (err) { next(err) }
})
