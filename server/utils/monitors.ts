import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { MonitorInput } from '../../shared/utils/validation'
import type { Db } from './db'

export async function defaultContactIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(eq(schema.contacts.isDefault, true))
  return rows.map((r) => r.id)
}

async function replaceContacts(db: Db, monitorId: string, contactIds: string[]): Promise<void> {
  await db.delete(schema.monitorContacts).where(eq(schema.monitorContacts.monitorId, monitorId))
  // One row per statement keeps us well under D1's 100-bound-parameter limit.
  for (const contactId of new Set(contactIds)) {
    await db.insert(schema.monitorContacts).values({ monitorId, contactId })
  }
}

export async function createMonitor(db: Db, input: MonitorInput, now: number, id: string): Promise<void> {
  const { contactIds, ...fields } = input
  await db.insert(schema.monitors).values({
    id,
    ...fields,
    status: fields.paused ? 'paused' : 'unknown',
    createdAt: now,
    updatedAt: now
  })
  await replaceContacts(db, id, contactIds)
}

/** Returns false if the monitor doesn't exist. Status is left to the engine/pause routes. */
export async function updateMonitor(db: Db, id: string, input: MonitorInput, now: number): Promise<boolean> {
  const existing = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })
  if (!existing) return false
  const { contactIds, ...fields } = input
  const status = fields.paused ? 'paused' : existing.status === 'paused' ? 'unknown' : existing.status
  await db
    .update(schema.monitors)
    .set({ ...fields, status, updatedAt: now })
    .where(eq(schema.monitors.id, id))
  await replaceContacts(db, id, contactIds)
  return true
}

export async function getMonitorWithContacts(db: Db, id: string) {
  const monitor = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })
  if (!monitor) return null
  const links = await db
    .select({ contactId: schema.monitorContacts.contactId })
    .from(schema.monitorContacts)
    .where(eq(schema.monitorContacts.monitorId, id))
  return { ...monitor, contactIds: links.map((l) => l.contactId) }
}
