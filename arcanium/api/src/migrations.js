// migrations.js — runs pending SQL migration files at startup.
// Creates a schema_migrations tracking table, skips already-applied files,
// wraps each migration in a transaction.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query, withTransaction } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations() {
  const res = await query(
    "SELECT filename FROM schema_migrations ORDER BY filename",
  );
  return new Set(res.rows.map((r) => r.filename));
}

export async function runMigrations() {
  await ensureTable();
  const applied = await appliedMigrations();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migration] already applied: ${file}`);
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    try {
      // Prompt 36 — was BEGIN/query(sql)/INSERT/COMMIT as four separate
      // pool.query() calls, each of which could land on a different
      // pooled connection — not actually one atomic transaction. A
      // migration that partially applied on one connection while the
      // tracking INSERT landed on another could be silently re-applied
      // (or half-applied) on next startup. withTransaction() holds one
      // client for the whole thing.
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [file],
        );
      });
      console.log(`[migration] applied: ${file}`);
    } catch (err) {
      throw new Error(`[migration] failed on ${file}: ${err.message}`);
    }
  }
}
