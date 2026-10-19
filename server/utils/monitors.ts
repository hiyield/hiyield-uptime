import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
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

async function replaceTags(db: Db, monitorId: string, tags: string[]): Promise<void> {
  await db.delete(schema.monitorTags).where(eq(schema.monitorTags.monitorId, monitorId))
  for (const tag of new Set(tags)) {
    await db.insert(schema.monitorTags).values({ monitorId, tag })
  }
}

export interface TagCount {
  tag: string
  count: number
}

/** Every tag in use, most-used first then alphabetical. */
export async function listTags(db: Db): Promise<TagCount[]> {
  const t = schema.monitorTags
  const count = sql<number>`count(*)`
  const rows = await db.select({ tag: t.tag, count }).from(t).groupBy(t.tag).orderBy(desc(count), asc(t.tag))
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }))
}

/** Tags per monitor, sorted. Monitors without tags map to []. Chunked to stay under D1's 100-parameter limit. */
export async function tagsByMonitor(db: Db, monitorIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(monitorIds.map((id) => [id, []]))
  const t = schema.monitorTags
  for (let i = 0; i < monitorIds.length; i += 90) {
    const rows = await db
      .select()
      .from(t)
      .where(inArray(t.monitorId, monitorIds.slice(i, i + 90)))
      .orderBy(asc(t.tag))
    for (const r of rows) out.get(r.monitorId)?.push(r.tag)
  }
  return out
}

export async function createMonitor(db: Db, input: MonitorInput, now: number, id: string): Promise<void> {
  const { contactIds, tags, ...fields } = input
  await db.insert(schema.monitors).values({
    id,
    ...fields,
    status: fields.paused ? 'paused' : 'unknown',
    createdAt: now,
    updatedAt: now
  })
  await replaceContacts(db, id, contactIds)
  await replaceTags(db, id, tags)
}

/** Returns false if the monitor doesn't exist. Status is left to the engine/pause routes. */
export async function updateMonitor(db: Db, id: string, input: MonitorInput, now: number): Promise<boolean> {
  const existing = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })
  if (!existing) return false
  const { contactIds, tags, ...fields } = input
  const status = fields.paused ? 'paused' : existing.status === 'paused' ? 'unknown' : existing.status
  await db
    .update(schema.monitors)
    .set({ ...fields, status, updatedAt: now })
    .where(eq(schema.monitors.id, id))
  await replaceContacts(db, id, contactIds)
  await replaceTags(db, id, tags)
  return true
}

export async function getMonitorWithContacts(db: Db, id: string) {
  const monitor = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })
  if (!monitor) return null
  const links = await db
    .select({ contactId: schema.monitorContacts.contactId })
    .from(schema.monitorContacts)
    .where(eq(schema.monitorContacts.monitorId, id))
  const tags = (await tagsByMonitor(db, [id])).get(id) ?? []
  return { ...monitor, contactIds: links.map((l) => l.contactId), tags }
}
