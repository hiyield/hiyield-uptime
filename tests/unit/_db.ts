import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../server/db/schema'
import type { Db } from '../../server/utils/db'

/**
 * In-memory SQLite built from the REAL migrations (same approach as qa's tests/unit/_db.ts).
 * better-sqlite3 stands in for D1 — same dialect; the cast is the whole substitution.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

export const T0 = 1_700_000_000_000

export function makeDb(): Db {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const dir = join(root, 'server/db/migrations')
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue
    try {
      sqlite.exec(readFileSync(join(dir, file), 'utf8'))
    } catch (e) {
      throw new Error(`migration ${file} failed: ${(e as Error).message}`, { cause: e })
    }
  }
  return drizzle(sqlite, { schema }) as unknown as Db
}

let seq = 0

export async function seedMonitor(db: Db, overrides: Partial<typeof schema.monitors.$inferInsert> = {}) {
  seq += 1
  const row = {
    id: `mon_${seq}`,
    name: `Site ${seq}`,
    url: `https://site${seq}.example/`,
    createdAt: T0,
    updatedAt: T0,
    ...overrides
  }
  await db.insert(schema.monitors).values(row)
  return row
}

export async function seedContact(db: Db, overrides: Partial<typeof schema.contacts.$inferInsert> = {}) {
  seq += 1
  const row = {
    id: `con_${seq}`,
    name: `Contact ${seq}`,
    type: 'slack' as const,
    target: `https://hooks.slack.com/services/T000/B000/${seq}abcdef`,
    createdAt: T0,
    ...overrides
  }
  await db.insert(schema.contacts).values(row)
  return row
}

export { schema }
