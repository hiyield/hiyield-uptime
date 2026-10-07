import { describe, expect, it } from 'vitest'
import { barState, boardCharts, bucketStarts, fleetUptime } from '../../server/utils/boardCharts'
import { makeDb, seedMonitor, schema } from './_db'

const H = 1_800_000
const D = 86_400_000
const NOW = Date.UTC(2026, 9, 7, 12, 10) // inside the 12:00 bucket
const zero = { checks: 0, failures: 0, blips: 0, maintenance: 0, respSum: 0, respCount: 0, respMax: 0 }
const c = (o: Partial<typeof zero>) => ({ ...zero, ...o })

describe('barState', () => {
  it('applies precedence down > blip > maintenance > up > none', () => {
    expect(barState(c({ checks: 3, failures: 1, blips: 1, maintenance: 1 }))).toBe('down')
    expect(barState(c({ checks: 3, blips: 1, maintenance: 1 }))).toBe('blip')
    expect(barState(c({ checks: 2, maintenance: 2 }))).toBe('maintenance')
    expect(barState(c({ checks: 2 }))).toBe('up')
    expect(barState(c({}))).toBe('none')
    expect(barState(undefined)).toBe('none')
  })
})

describe('bucketStarts', () => {
  it('returns 48 aligned buckets ending with the current one', () => {
    const b = bucketStarts(NOW, 48, H)
    expect(b).toHaveLength(48)
    expect(b[47]).toBe(Date.UTC(2026, 9, 7, 12, 0))
    expect(b[0]).toBe(Date.UTC(2026, 9, 7, 12, 0) - 47 * H)
  })
})

describe('fleetUptime', () => {
  it('excludes maintenance and returns null with nothing counted', () => {
    expect(fleetUptime([c({ checks: 10, failures: 1, maintenance: 2 })])).toBe(87.5)
    expect(fleetUptime([c({ checks: 2, maintenance: 2 })])).toBeNull()
    expect(fleetUptime([])).toBeNull()
  })
})

describe('boardCharts', () => {
  it('empty rollups: all none/null, zero incidents, no NaN', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const { perMonitor, summary } = await boardCharts(db, [m.id], NOW)
    const mc = perMonitor.get(m.id)!
    expect(mc.bars).toEqual(Array(48).fill('none'))
    expect(mc.spark).toEqual(Array(48).fill(null))
    expect(mc.uptime24h).toBeNull()
    expect(summary).toMatchObject({
      uptime24h: null,
      uptime30d: null,
      avgResponse24h: null,
      incidents7d: 0,
      incidentsPrev7d: 0
    })
    expect(summary.series.incidents14d).toEqual(Array(14).fill(0))
    expect(JSON.stringify(summary)).not.toMatch(/NaN|Infinity/)
  })

  it('maps rows into the right buckets with gaps', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const cur = Date.UTC(2026, 9, 7, 12, 0)
    await db.insert(schema.rollup30m).values([
      { monitorId: m.id, bucketStart: cur, checks: 2, respSum: 300, respCount: 2, respMax: 200 },
      {
        monitorId: m.id,
        bucketStart: cur - 2 * H,
        checks: 2,
        failures: 1,
        respSum: 100,
        respCount: 1,
        respMax: 100
      },
      { monitorId: m.id, bucketStart: cur - 48 * H, checks: 5 } // outside the window
    ])
    const mc = (await boardCharts(db, [m.id], NOW)).perMonitor.get(m.id)!
    expect(mc.bars[47]).toBe('up')
    expect(mc.bars[46]).toBe('none')
    expect(mc.bars[45]).toBe('down')
    expect(mc.spark[47]).toBe(150)
    expect(mc.spark[46]).toBeNull()
    expect(mc.barStats[45]).toEqual({ checks: 2, failures: 1, avgMs: 100 })
    expect(mc.uptime24h).toBe(75)
  })

  it('summarises the fleet: 30d uptime and incidents 7d vs previous 7d', async () => {
    const db = makeDb()
    const a = await seedMonitor(db)
    const b = await seedMonitor(db)
    const today = Date.UTC(2026, 9, 7)
    await db.insert(schema.rollupDaily).values([
      { monitorId: a.id, dayStart: today, checks: 100, failures: 1 },
      { monitorId: b.id, dayStart: today - 29 * D, checks: 100, failures: 3 },
      { monitorId: b.id, dayStart: today - 30 * D, checks: 100, failures: 100 } // outside 30d
    ])
    await db.insert(schema.incidents).values([
      { id: 'i1', monitorId: a.id, startedAt: today + 1000, confirmedAt: today + 1000, cause: 'x' },
      { id: 'i2', monitorId: a.id, startedAt: today - 8 * D, confirmedAt: today - 8 * D, cause: 'x' },
      { id: 'i3', monitorId: b.id, startedAt: today - 10 * D, confirmedAt: today - 10 * D, cause: 'x' }
    ])
    const { summary } = await boardCharts(db, [a.id, b.id], NOW)
    expect(summary.uptime30d).toBe(98)
    expect(summary.incidents7d).toBe(1)
    expect(summary.incidentsPrev7d).toBe(2)
    expect(summary.series.days14[13]).toBe(today)
    expect(summary.series.incidents14d[13]).toBe(1)
    expect(summary.series.uptime30d[29]).toBe(99)
  })
})
