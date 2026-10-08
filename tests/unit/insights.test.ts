import { describe, expect, it } from 'vitest'
import { getInsights, insightsQuerySchema } from '../../server/utils/insights'
import { makeDb, seedMonitor, schema } from './_db'

const D = 86_400_000
const today = Date.UTC(2026, 9, 7)
const NOW = today + 12 * 3_600_000

describe('insightsQuerySchema', () => {
  it('defaults to 30d and rejects unknown ranges', () => {
    expect(insightsQuerySchema.parse({})).toEqual({ range: '30d' })
    expect(insightsQuerySchema.safeParse({ range: '2d' }).success).toBe(false)
  })
})

describe('getInsights', () => {
  it('no data: empty lists, null uptime/MTTR, periods present, no NaN', async () => {
    const db = makeDb()
    await seedMonitor(db)
    const r = await getInsights(db, '7d', NOW)
    expect(r.periods).toHaveLength(7)
    expect(r.tiles).toEqual({ uptime: null, incidents: 0, downtimeMs: 0, mttrMs: null })
    expect(r.worst).toEqual([])
    expect(r.slowest).toEqual([])
    expect(r.from).toBe(today - 6 * D)
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
  })

  it('computes tiles, per-day downtime, worst and slowest', async () => {
    const db = makeDb()
    const a = await seedMonitor(db, { name: 'Acme' })
    const b = await seedMonitor(db, { name: 'Beta' })
    await db.insert(schema.rollupDaily).values([
      {
        monitorId: a.id,
        dayStart: today,
        checks: 100,
        failures: 2,
        respSum: 30_000,
        respCount: 100,
        respMax: 900
      },
      {
        monitorId: b.id,
        dayStart: today - D,
        checks: 100,
        failures: 0,
        respSum: 10_000,
        respCount: 100,
        respMax: 200
      }
    ])
    await db.insert(schema.incidents).values([
      // spans midnight into today: 10 min yesterday, 20 min today, resolved
      {
        id: 'i1',
        monitorId: a.id,
        startedAt: today - 600_000,
        confirmedAt: today - 600_000,
        resolvedAt: today + 1_200_000,
        cause: 'x'
      },
      // still open, started 1h before NOW
      { id: 'i2', monitorId: b.id, startedAt: NOW - 3_600_000, confirmedAt: NOW - 3_600_000, cause: 'x' },
      // before the range entirely
      {
        id: 'i3',
        monitorId: b.id,
        startedAt: today - 20 * D,
        confirmedAt: today - 20 * D,
        resolvedAt: today - 20 * D + 1000,
        cause: 'x'
      }
    ])
    const r = await getInsights(db, '7d', NOW)
    expect(r.tiles).toEqual({
      uptime: 99,
      incidents: 2,
      downtimeMs: 1_800_000 + 3_600_000,
      mttrMs: 1_800_000
    })
    const last = r.periods[6]!
    const prev = r.periods[5]!
    expect(prev).toMatchObject({ downtimeMs: 600_000, incidents: 1, sites: [{ id: a.id, name: 'Acme' }] })
    expect(last.downtimeMs).toBe(1_200_000 + 3_600_000)
    expect(last.sites.map((s) => s.name).sort()).toEqual(['Acme', 'Beta'])
    expect(r.worst.map((w) => [w.name, w.downtimeMs])).toEqual([
      ['Beta', 3_600_000],
      ['Acme', 1_800_000]
    ])
    expect(r.slowest).toEqual([
      { id: a.id, name: 'Acme', avgMs: 300, maxMs: 900 },
      { id: b.id, name: 'Beta', avgMs: 100, maxMs: 200 }
    ])
  })

  it('1y aggregates into 7-day periods built backward from now', async () => {
    const db = makeDb()
    const r = await getInsights(db, '1y', NOW)
    expect(r.periods).toHaveLength(53) // 365 days → 52 full weeks back from now + 1 shorter oldest period
    const last = r.periods[52]!
    expect(last.end).toBe(NOW)
    expect(last.start).toBe(today - 6 * D) // newest period: the 7 calendar days ending today (today truncated at NOW)
    const first = r.periods[0]!
    expect(first.start).toBe(r.from)
    expect(first.end - first.start).toBeLessThan(7 * D) // oldest period may be shorter
    expect(first.end - first.start).toBe(D) // 365 % 7 === 1 leftover day
    for (let i = 0; i < r.periods.length - 1; i++) {
      expect(r.periods[i]!.end).toBe(r.periods[i + 1]!.start) // periods are contiguous
    }
    expect(last.start - first.start).toBe(358 * D) // 52 weeks - 1 day: periods together span all 365 days
  })

  it('caps rankings at 10', async () => {
    const db = makeDb()
    for (let i = 0; i < 12; i++) {
      const m = await seedMonitor(db, { name: `S${String(i).padStart(2, '0')}` })
      await db.insert(schema.rollupDaily).values({
        monitorId: m.id,
        dayStart: today,
        checks: 1,
        respSum: 100 + i,
        respCount: 1,
        respMax: 100 + i
      })
    }
    const r = await getInsights(db, '7d', NOW)
    expect(r.slowest).toHaveLength(10)
    expect(r.slowest[0]!.name).toBe('S11')
  })
})
