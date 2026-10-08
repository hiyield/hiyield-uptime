import { and, gt, gte, isNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../db/schema'
import { DAY_MS } from '../../shared/utils/constants'
import { avgMs, bucketStarts, fleetUptime, type Counters } from './boardCharts'
import { downtimeByMonitor, downtimeByPeriod, type IncidentSpan, type Period } from './downtime'
import type { Db } from './db'

export const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 } as const
export type RangeKey = keyof typeof RANGE_DAYS
export const insightsQuerySchema = z.object({ range: z.enum(['7d', '30d', '90d', '1y']).default('30d') })

export interface InsightsPeriod {
  start: number
  end: number
  downtimeMs: number
  incidents: number
  sites: { id: string; name: string }[]
}
export interface Insights {
  range: RangeKey
  from: number
  to: number
  tiles: { uptime: number | null; incidents: number; downtimeMs: number; mttrMs: number | null }
  periods: InsightsPeriod[]
  worst: { id: string; name: string; downtimeMs: number; incidents: number; uptime: number | null }[]
  slowest: { id: string; name: string; avgMs: number; maxMs: number }[]
}

function buildPeriods(range: RangeKey, now: number): Period[] {
  const days = bucketStarts(now, RANGE_DAYS[range], DAY_MS)
  const step = range === '1y' ? 7 : 1
  if (step === 1) {
    return days.map((start, i) => ({ start, end: i + 1 < days.length ? days[i + 1]! : now }))
  }
  // Group backward from `now` in `step`-day chunks so the NEWEST period is always a full
  // `step`-day period ending now; any leftover days land in the OLDEST period, which may be
  // shorter. Grouping forward from the oldest day (as a naive loop would) instead leaves a
  // stray one-day "week" at the newest end, which is wrong for charting recent trends.
  const out: Period[] = []
  let end = now
  let idx = days.length
  while (idx > 0) {
    const take = Math.min(step, idx)
    const start = days[idx - take]!
    out.push({ start, end })
    end = start
    idx -= take
  }
  return out.reverse()
}

export async function getInsights(db: Db, range: RangeKey, now: number): Promise<Insights> {
  const periods = buildPeriods(range, now)
  const from = periods[0]!.start
  const whole: Period = { start: from, end: now }

  const names = new Map(
    (await db.select({ id: schema.monitors.id, name: schema.monitors.name }).from(schema.monitors)).map(
      (m) => [m.id, m.name]
    )
  )
  const daily = await db.select().from(schema.rollupDaily).where(gte(schema.rollupDaily.dayStart, from))
  const i = schema.incidents
  const incidents = await db
    .select({ monitorId: i.monitorId, startedAt: i.startedAt, resolvedAt: i.resolvedAt })
    .from(i)
    .where(and(lt(i.startedAt, now), or(isNull(i.resolvedAt), gt(i.resolvedAt, from))))
  const spans: IncidentSpan[] = incidents

  const startedIn = (p: Period) => spans.filter((s) => s.startedAt >= p.start && s.startedAt < p.end)
  const resolved = spans.filter((s) => s.resolvedAt !== null && s.resolvedAt >= from && s.resolvedAt < now)
  const perPeriod = downtimeByPeriod(spans, periods, now)
  const perMonitorDown = downtimeByMonitor(spans, whole, now)

  const dailyBy = new Map<string, Counters[]>()
  for (const r of daily) dailyBy.set(r.monitorId, [...(dailyBy.get(r.monitorId) ?? []), r])

  const worst = [...perMonitorDown.entries()]
    .filter(([id]) => names.has(id))
    .map(([id, ms]) => ({
      id,
      name: names.get(id)!,
      downtimeMs: ms,
      incidents: startedIn(whole).filter((s) => s.monitorId === id).length,
      uptime: fleetUptime(dailyBy.get(id) ?? [])
    }))
    .sort((a, b) => b.downtimeMs - a.downtimeMs || a.name.localeCompare(b.name))
    .slice(0, 10)

  const slowest = [...dailyBy.entries()]
    .filter(([id]) => names.has(id))
    .map(([id, rows]) => {
      const respSum = rows.reduce((a, r) => a + r.respSum, 0)
      const respCount = rows.reduce((a, r) => a + r.respCount, 0)
      return {
        id,
        name: names.get(id)!,
        respCount,
        avg: avgMs({ ...rows[0]!, respSum, respCount }),
        maxMs: Math.max(...rows.map((r) => r.respMax))
      }
    })
    .filter((r) => r.respCount > 0 && r.avg !== null)
    .map((r) => ({ id: r.id, name: r.name, avgMs: r.avg!, maxMs: r.maxMs }))
    .sort((a, b) => b.avgMs - a.avgMs || a.name.localeCompare(b.name))
    .slice(0, 10)

  return {
    range,
    from,
    to: now,
    tiles: {
      uptime: fleetUptime(daily),
      incidents: startedIn(whole).length,
      downtimeMs: [...perMonitorDown.values()].reduce((a, b) => a + b, 0),
      mttrMs: resolved.length
        ? Math.round(resolved.reduce((a, s) => a + (s.resolvedAt! - s.startedAt), 0) / resolved.length)
        : null
    },
    periods: periods.map((p, idx) => ({
      start: p.start,
      end: p.end,
      downtimeMs: perPeriod[idx]!.ms,
      incidents: startedIn(p).length,
      sites: perPeriod[idx]!.monitorIds.filter((id) => names.has(id)).map((id) => ({
        id,
        name: names.get(id)!
      }))
    })),
    worst,
    slowest
  }
}
