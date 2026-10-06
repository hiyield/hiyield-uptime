import { and, eq, gt, isNull, lte, or } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import type { Contact, MonitorConfig, MonitorStatus } from './types'

/** Same shape as server/utils/db.ts `Db`; redeclared so the engine never imports Nitro code. */
export type EngineDb = DrizzleD1Database<typeof schema>
export type NewCheck = typeof schema.checks.$inferInsert
export type NewDelivery = typeof schema.alertDeliveries.$inferInsert

export interface MonitorStatusPatch {
  status: MonitorStatus
  consecutiveFailures: number
  lastCheckedAt: number
  lastResponseMs: number | null
  lastStatusCode: number | null
}

export async function getMonitor(db: EngineDb, id: string): Promise<MonitorConfig | null> {
  const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    intervalS: row.intervalS,
    timeoutMs: row.timeoutMs,
    failThreshold: row.failThreshold,
    reminderMins: row.reminderMins,
    paused: row.paused
  }
}

/** A window applies if it targets this monitor or all monitors (monitor_id null). End is exclusive. */
export async function isInMaintenance(db: EngineDb, monitorId: string, now: number): Promise<boolean> {
  const w = schema.maintenanceWindows
  const rows = await db
    .select({ id: w.id })
    .from(w)
    .where(and(or(eq(w.monitorId, monitorId), isNull(w.monitorId)), lte(w.startsAt, now), gt(w.endsAt, now)))
    .limit(1)
  return rows.length > 0
}

export async function insertChecks(db: EngineDb, rows: NewCheck[]): Promise<void> {
  if (rows.length) await db.insert(schema.checks).values(rows)
}

export async function insertIncident(
  db: EngineDb,
  row: { id: string; monitorId: string; startedAt: number; confirmedAt: number; cause: string }
): Promise<void> {
  await db.insert(schema.incidents).values(row)
}

export async function resolveIncident(db: EngineDb, id: string, resolvedAt: number): Promise<void> {
  await db
    .update(schema.incidents)
    .set({ resolvedAt })
    .where(and(eq(schema.incidents.id, id), isNull(schema.incidents.resolvedAt)))
}

export async function resolveOpenIncidents(
  db: EngineDb,
  monitorId: string,
  resolvedAt: number
): Promise<void> {
  await db
    .update(schema.incidents)
    .set({ resolvedAt })
    .where(and(eq(schema.incidents.monitorId, monitorId), isNull(schema.incidents.resolvedAt)))
}

export async function setIncidentReminder(db: EngineDb, id: string, at: number): Promise<void> {
  await db.update(schema.incidents).set({ lastReminderAt: at }).where(eq(schema.incidents.id, id))
}

export async function getContactsForMonitor(db: EngineDb, monitorId: string): Promise<Contact[]> {
  return db
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      type: schema.contacts.type,
      target: schema.contacts.target
    })
    .from(schema.contacts)
    .innerJoin(schema.monitorContacts, eq(schema.monitorContacts.contactId, schema.contacts.id))
    .where(eq(schema.monitorContacts.monitorId, monitorId))
}

export async function insertDelivery(db: EngineDb, row: NewDelivery): Promise<void> {
  await db.insert(schema.alertDeliveries).values(row)
}

export async function updateMonitorStatus(
  db: EngineDb,
  id: string,
  patch: MonitorStatusPatch
): Promise<void> {
  await db.update(schema.monitors).set(patch).where(eq(schema.monitors.id, id))
}
