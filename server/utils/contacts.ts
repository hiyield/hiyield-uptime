import { eq, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { contactCreateSchema, type ContactUpdate } from '../../shared/utils/validation'
import type { Db } from './db'

export interface ContactListItem {
  id: string
  name: string
  type: 'slack' | 'email'
  targetMasked: string
  isDefault: boolean
  monitors: { id: string; name: string }[]
  lastDelivery: { ok: boolean; at: number; error: string | null } | null
}

/** Slack webhook URLs are credentials — only the last 6 characters ever leave the server. */
export function maskTarget(type: 'slack' | 'email', target: string): string {
  return type === 'slack' ? `…${target.slice(-6)}` : target
}

export async function listContacts(db: Db): Promise<ContactListItem[]> {
  const contacts = await db.select().from(schema.contacts).orderBy(schema.contacts.name)
  const links = await db
    .select({
      contactId: schema.monitorContacts.contactId,
      id: schema.monitors.id,
      name: schema.monitors.name
    })
    .from(schema.monitorContacts)
    .innerJoin(schema.monitors, eq(schema.monitors.id, schema.monitorContacts.monitorId))
  // SQLite returns the bare columns from the row holding max(sent_at).
  const latest = await db
    .select({
      contactId: schema.alertDeliveries.contactId,
      ok: schema.alertDeliveries.ok,
      error: schema.alertDeliveries.error,
      at: sql<number>`max(${schema.alertDeliveries.sentAt})`
    })
    .from(schema.alertDeliveries)
    .groupBy(schema.alertDeliveries.contactId)

  return contacts.map((c) => {
    const last = latest.find((l) => l.contactId === c.id)
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      targetMasked: maskTarget(c.type, c.target),
      isDefault: c.isDefault,
      monitors: links.filter((l) => l.contactId === c.id).map((l) => ({ id: l.id, name: l.name })),
      lastDelivery: last ? { ok: Boolean(last.ok), at: Number(last.at), error: last.error } : null
    }
  })
}

export async function updateContact(
  db: Db,
  id: string,
  input: ContactUpdate
): Promise<{ ok: true } | { ok: false; status: 400 | 404; message: string }> {
  const existing = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, id) })
  if (!existing) return { ok: false, status: 404, message: 'Contact not found' }
  let target = existing.target
  if (input.target) {
    const parsed = contactCreateSchema.safeParse({
      type: existing.type,
      name: input.name,
      target: input.target
    })
    if (!parsed.success) return { ok: false, status: 400, message: parsed.error.issues[0]!.message }
    target = parsed.data.target
  }
  await db
    .update(schema.contacts)
    .set({ name: input.name, isDefault: input.isDefault, target })
    .where(eq(schema.contacts.id, id))
  return { ok: true }
}
