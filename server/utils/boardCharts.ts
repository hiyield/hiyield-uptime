import { gte } from 'drizzle-orm'
import * as schema from '../db/schema'
import { BOARD_BUCKETS, DAY_MS, ROLLUP_30M_MS } from '../../shared/utils/constants'
import { uptimePercent } from './uptime'
import type { Db } from './db'

export type BarState = 'down' | 'blip' | 'maintenance' | 'up' | 'none'
export interface Counters {
  checks: number
  failures: number
  blips: number
  maintenance: number
  respSum: number
  respCount: number
  respMax: number
}
export interface BarStat {
  checks: number
  failures: number
  avgMs: number | null
}
export interface MonitorCharts {
  bars: BarState[]
  barStats: BarStat[]
  spark: (number | null)[]
  uptime24h: number | null
}
export interface BoardSummary {
  downNow: number
  uptime24h: number | null
  uptime30d: number | null
  incidents7d: number
  incidentsPrev7d: number
  avgResponse24h: number | null
  series: {
    buckets: number[]
    uptime24h: (number | null)[]
    response24h: (number | null)[]
    days30: number[]
    uptime30d: (number | null)[]
    days14: number[]
    incidents14d: number[]
  }
}

export function barState(c: Counters | undefined): BarState {
  if (!c || c.checks === 0) return 'none'
  if (c.failures > 0) return 'down'
  if (c.blips > 0) return 'blip'
  if (c.maintenance > 0) return 'maintenance'
  return 'up'
}

export function bucketStarts(now: number, count: number, size: number): number[] {
  const last = Math.floor(now / size) * size
  return Array.from({ length: count }, (_, i) => last - (count - 1 - i) * size)
}

const sum = (rows: Counters[]): Counters =>
  rows.reduce(
    (a, r) => ({
      checks: a.checks + r.checks,
      failures: a.failures + r.failures,
      blips: a.blips + r.blips,
      maintenance: a.maintenance + r.maintenance,
      respSum: a.respSum + r.respSum,
      respCount: a.respCount + r.respCount,
      respMax: Math.max(a.respMax, r.respMax)
    }),
    { checks: 0, failures: 0, blips: 0, maintenance: 0, respSum: 0, respCount: 0, respMax: 0 }
  )

export function fleetUptime(rows: Counters[]): number | null {
  const s = sum(rows)
  return uptimePercent(s.checks - s.maintenance, s.failures)
}

export function avgMs(c: Counters | undefined): number | null {
  return c && c.respCount > 0 ? Math.round(c.respSum / c.respCount) : null
}

export async function boardCharts(
  db: Db,
  monitorIds: string[],
  now: number
): Promise<{ perMonitor: Map<string, MonitorCharts>; summary: Omit<BoardSummary, 'downNow'> }> {
  const buckets = bucketStarts(now, BOARD_BUCKETS, ROLLUP_30M_MS)
  const days30 = bucketStarts(now, 30, DAY_MS)
  const days14 = days30.slice(-14)

  const r30 = await db.select().from(schema.rollup30m).where(gte(schema.rollup30m.bucketStart, buckets[0]!))
  const rd = await db.select().from(schema.rollupDaily).where(gte(schema.rollupDaily.dayStart, days30[0]!))
  // D1 binds one parameter per `inArray` value and rejects statements over 100 bound params, so a
  // fleet of >=100 monitors would 500 here. Incidents cascade-delete with their monitor, so we don't
  // need to filter by monitor_id in SQL at all — filter the (already small) result set in JS instead.
  const monitorIdSet = new Set(monitorIds)
  const inc = (
    await db
      .select({ monitorId: schema.incidents.monitorId, startedAt: schema.incidents.startedAt })
      .from(schema.incidents)
      .where(gte(schema.incidents.startedAt, days14[0]!))
  ).filter((i) => monitorIdSet.has(i.monitorId))

  const byMonitorBucket = new Map<string, Counters>()
  for (const r of r30) byMonitorBucket.set(`${r.monitorId}:${r.bucketStart}`, r)

  const perMonitor = new Map<string, MonitorCharts>()
  for (const id of monitorIds) {
    const rows = buckets.map((b) => byMonitorBucket.get(`${id}:${b}`))
    perMonitor.set(id, {
      bars: rows.map(barState),
      barStats: rows.map((r) => ({ checks: r?.checks ?? 0, failures: r?.failures ?? 0, avgMs: avgMs(r) })),
      spark: rows.map(avgMs),
      uptime24h: fleetUptime(rows.filter((r): r is Counters => !!r))
    })
  }

  const inWindow = r30.filter((r) => r.bucketStart >= buckets[0]!)
  const perBucket = buckets.map((b) => inWindow.filter((r) => r.bucketStart === b))
  const perDay = days30.map((d) => rd.filter((r) => r.dayStart === d))
  const incidents14d = days14.map(
    (d) => inc.filter((i) => i.startedAt >= d && i.startedAt < d + DAY_MS).length
  )

  return {
    perMonitor,
    summary: {
      uptime24h: fleetUptime(inWindow),
      uptime30d: fleetUptime(rd),
      incidents7d: incidents14d.slice(7).reduce((a, b) => a + b, 0),
      incidentsPrev7d: incidents14d.slice(0, 7).reduce((a, b) => a + b, 0),
      avgResponse24h: avgMs(sum(inWindow)),
      series: {
        buckets,
        uptime24h: perBucket.map(fleetUptime),
        response24h: perBucket.map((rows) => avgMs(sum(rows))),
        days30,
        uptime30d: perDay.map(fleetUptime),
        days14,
        incidents14d
      }
    }
  }
}
