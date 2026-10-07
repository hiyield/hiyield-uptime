import { and, desc, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { STATUS_SORT, type MonitorStatus } from '../../shared/utils/status'
import type { Db } from './db'

export const DAY = 86_400_000
const c = schema.checks

export function uptimePercent(total: number, failures: number): number | null {
  if (total === 0) return null
  return Math.round(((total - failures) / total) * 10_000) / 100
}

const counted = (since: number) =>
  and(gte(c.checkedAt, since), eq(c.region, 'primary'), eq(c.maintenance, false))
const totalSql = sql<number>`count(*)`
const failuresSql = sql<number>`coalesce(sum(case when ${c.ok} = 0 and ${c.confirmed} = 1 then 1 else 0 end), 0)`

export async function uptimeFor(db: Db, monitorId: string, since: number): Promise<number | null> {
  const [row] = await db
    .select({ total: totalSql, failures: failuresSql })
    .from(c)
    .where(and(eq(c.monitorId, monitorId), counted(since)))
  return uptimePercent(Number(row?.total ?? 0), Number(row?.failures ?? 0))
}

export async function uptimeByMonitor(db: Db, since: number): Promise<Map<string, number | null>> {
  const rows = await db
    .select({ monitorId: c.monitorId, total: totalSql, failures: failuresSql })
    .from(c)
    .where(counted(since))
    .groupBy(c.monitorId)
  return new Map(rows.map((r) => [r.monitorId, uptimePercent(Number(r.total), Number(r.failures))]))
}

export async function responseSeries(db: Db, monitorId: string, since: number, bucketMs: number) {
  const b = sql.raw(String(Math.trunc(bucketMs))) // server-chosen constant, never user input
  const bucket = sql<number>`cast(${c.checkedAt} / ${b} as integer) * ${b}`
  const rows = await db
    .select({ t: bucket, avgMs: sql<number>`avg(${c.responseMs})` })
    .from(c)
    .where(
      and(
        eq(c.monitorId, monitorId),
        gte(c.checkedAt, since),
        eq(c.region, 'primary'),
        isNotNull(c.responseMs)
      )
    )
    .groupBy(bucket)
    .orderBy(bucket)
  return rows.map((r) => ({ t: Number(r.t), avgMs: Math.round(Number(r.avgMs)) }))
}

export interface BoardRow {
  id: string
  name: string
  url: string
  status: MonitorStatus
  paused: boolean
  intervalS: number
  lastCheckedAt: number | null
  lastResponseMs: number | null
  lastStatusCode: number | null
  uptime24h: number | null
  downSince: number | null
  inMaintenance: boolean
}

async function activeMaintenance(db: Db, now: number): Promise<{ global: boolean; monitors: Set<string> }> {
  const w = schema.maintenanceWindows
  const rows = await db
    .select({ monitorId: w.monitorId })
    .from(w)
    .where(and(lte(w.startsAt, now), gt(w.endsAt, now)))
  return {
    global: rows.some((r) => r.monitorId === null),
    monitors: new Set(rows.flatMap((r) => (r.monitorId ? [r.monitorId] : [])))
  }
}

export async function listBoard(db: Db, now: number): Promise<BoardRow[]> {
  const monitors = await db.select().from(schema.monitors)
  const uptime = await uptimeByMonitor(db, now - DAY)
  const open = await db
    .select({
      monitorId: schema.incidents.monitorId,
      startedAt: sql<number>`min(${schema.incidents.startedAt})`
    })
    .from(schema.incidents)
    .where(isNull(schema.incidents.resolvedAt))
    .groupBy(schema.incidents.monitorId)
  const downSince = new Map(open.map((o) => [o.monitorId, Number(o.startedAt)]))
  const maint = await activeMaintenance(db, now)

  return monitors
    .map((m) => ({
      id: m.id,
      name: m.name,
      url: m.url,
      status: m.status,
      paused: m.paused,
      intervalS: m.intervalS,
      lastCheckedAt: m.lastCheckedAt,
      lastResponseMs: m.lastResponseMs,
      lastStatusCode: m.lastStatusCode,
      uptime24h: uptime.get(m.id) ?? null,
      downSince: downSince.get(m.id) ?? null,
      inMaintenance: maint.global || maint.monitors.has(m.id)
    }))
    .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status] || a.name.localeCompare(b.name))
}

export function findStaleMonitors(
  rows: { id: string; intervalS: number; paused: boolean; lastCheckedAt: number | null; createdAt: number }[],
  now: number
): string[] {
  return rows
    .filter((r) => !r.paused)
    .filter((r) => now - (r.lastCheckedAt ?? r.createdAt) > Math.max(2 * r.intervalS * 1000, 120_000))
    .map((r) => r.id)
}

export async function pruneChecks(db: Db, before: number): Promise<void> {
  await db.delete(c).where(lt(c.checkedAt, before))
}

export async function getHistory(db: Db, monitorId: string, now: number) {
  const w = schema.maintenanceWindows
  const d = schema.alertDeliveries
  const [h24, d7, d30, series24, series7, incidents, checks, deliveries, maintenance] = await Promise.all([
    uptimeFor(db, monitorId, now - DAY),
    uptimeFor(db, monitorId, now - 7 * DAY),
    uptimeFor(db, monitorId, now - 30 * DAY),
    responseSeries(db, monitorId, now - DAY, 5 * 60_000),
    responseSeries(db, monitorId, now - 7 * DAY, 60 * 60_000),
    db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.monitorId, monitorId))
      .orderBy(desc(schema.incidents.startedAt))
      .limit(50),
    db.select().from(c).where(eq(c.monitorId, monitorId)).orderBy(desc(c.checkedAt), desc(c.id)).limit(50),
    db
      .select({
        id: d.id,
        kind: d.kind,
        attempt: d.attempt,
        ok: d.ok,
        error: d.error,
        sentAt: d.sentAt,
        contactName: schema.contacts.name
      })
      .from(d)
      .innerJoin(schema.contacts, eq(schema.contacts.id, d.contactId))
      .where(eq(d.monitorId, monitorId))
      .orderBy(desc(d.sentAt))
      .limit(50),
    db
      .select()
      .from(w)
      .where(and(or(eq(w.monitorId, monitorId), isNull(w.monitorId)), gt(w.endsAt, now - 7 * DAY)))
      .orderBy(desc(w.startsAt))
  ])
  return {
    uptime: { h24, d7, d30 },
    series: { h24: series24, d7: series7 },
    incidents,
    checks,
    deliveries,
    maintenance
  }
}

export type MonitorHistory = Awaited<ReturnType<typeof getHistory>>
