// routes/applications.js — CRUD for registered applications.

import { Router } from 'express'
import { query }  from '../db.js'

export const applicationsRouter = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME_RE = /^[a-z0-9_-]{1,128}$/i

function validateUuid(id) {
  if (!UUID_RE.test(id)) {
    const err = new Error('invalid id format')
    err.status = 400
    throw err
  }
}

function notFound() {
  const err = new Error('not found')
  err.status = 404
  return err
}

// GET /api/v1/applications
applicationsRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, name, description, registered_at FROM applications ORDER BY registered_at DESC'
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// POST /api/v1/applications
applicationsRouter.post('/', async (req, res, next) => {
  try {
    const { name, description } = req.body ?? {}
    if (!name)              return res.status(400).json({ error: 'name is required', field: 'name' })
    if (!NAME_RE.test(name)) return res.status(400).json({ error: 'name must match /^[a-z0-9_-]{1,128}$/i', field: 'name' })
    if (description && description.length > 512)
      return res.status(400).json({ error: 'description max 512 chars', field: 'description' })

    const { rows } = await query(
      'INSERT INTO applications (name, description) VALUES ($1, $2) RETURNING id, name, description, registered_at',
      [name, description ?? null]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'name already registered' })
    next(err)
  }
})

// GET /api/v1/applications/:id
applicationsRouter.get('/:id', async (req, res, next) => {
  try {
    validateUuid(req.params.id)
    const { rows: apps } = await query(
      'SELECT id, name, description, registered_at FROM applications WHERE id = $1',
      [req.params.id]
    )
    if (!apps.length) return next(notFound())

    const { rows: profiles } = await query(
      'SELECT id, type, vault_path, created_at FROM crypto_profiles WHERE application_id = $1 ORDER BY created_at',
      [req.params.id]
    )
    res.json({ ...apps[0], crypto_profiles: profiles })
  } catch (err) { next(err) }
})

// PATCH /api/v1/applications/:id
applicationsRouter.patch('/:id', async (req, res, next) => {
  try {
    validateUuid(req.params.id)
    const { description } = req.body ?? {}
    if (description !== undefined && description !== null && description.length > 512)
      return res.status(400).json({ error: 'description max 512 chars', field: 'description' })

    const { rows } = await query(
      'UPDATE applications SET description = $1 WHERE id = $2 RETURNING id, name, description, registered_at',
      [description ?? null, req.params.id]
    )
    if (!rows.length) return next(notFound())
    res.json(rows[0])
  } catch (err) { next(err) }
})

// DELETE /api/v1/applications/:id
applicationsRouter.delete('/:id', async (req, res, next) => {
  try {
    validateUuid(req.params.id)
    const { rowCount } = await query('DELETE FROM applications WHERE id = $1', [req.params.id])
    if (!rowCount) return next(notFound())
    res.status(204).end()
  } catch (err) { next(err) }
})
