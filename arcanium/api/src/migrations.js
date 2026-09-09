// migrations.js — runs pending SQL migration files at startup.
// Creates a schema_migrations tracking table, skips already-applied files,
// wraps each migration in a transaction.

import { readdir, readFile } from 'node:fs/promises'
import { join, dirname }     from 'node:path'
import { fileURLToPath }     from 'node:url'
import { query }             from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function appliedMigrations() {
  const res = await query('SELECT filename FROM schema_migrations ORDER BY filename')
  return new Set(res.rows.map(r => r.filename))
}

export async function runMigrations() {
  await ensureTable()
  const applied = await appliedMigrations()

  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migration] already applied: ${file}`)
      continue
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    try {
      await query('BEGIN')
      await query(sql)
      await query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file])
      await query('COMMIT')
      console.log(`[migration] applied: ${file}`)
    } catch (err) {
      await query('ROLLBACK').catch(() => {})
      throw new Error(`[migration] failed on ${file}: ${err.message}`)
    }
  }
}
