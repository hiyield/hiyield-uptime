import { describe, expect, it } from 'vitest'
import { bucket30m, dayStart, rollupDelta } from '../../server/engine/rollup'
import type { CheckResult } from '../../server/engine/types'
import { makeDb, seedMonitor, schema, T0 } from './_db'

const check = (o: Partial<CheckResult> = {}): CheckResult => ({
  ok: true,
  statusCode: 200,
  responseMs: 120,
  error: null,
  checkedAt: T0,
  ...o
})

describe('bucket helpers', () => {
  it('floors to 30 minutes and to the UTC day', () => {
    const t = Date.UTC(2026, 9, 7, 13, 47, 12)
    expect(bucket30m(t)).toBe(Date.UTC(2026, 9, 7, 13, 30))
    expect(bucket30m(Date.UTC(2026, 9, 7, 13, 30))).toBe(Date.UTC(2026, 9, 7, 13, 30))
    expect(dayStart(t)).toBe(Date.UTC(2026, 9, 7))
    expect(dayStart(Date.UTC(2026, 9, 7, 23, 59, 59, 999))).toBe(Date.UTC(2026, 9, 7))
  })
})

describe('rollupDelta', () => {
  it('counts a healthy check', () => {
    expect(rollupDelta(check(), { confirmed: false, maintenance: false })).toEqual({
      checks: 1,
      failures: 0,
      blips: 0,
      maintenance: 0,
      respSum: 120,
      respCount: 1,
      respMax: 120
    })
  })
  it('counts a confirmed failure', () => {
    expect(
      rollupDelta(check({ ok: false, statusCode: 503 }), { confirmed: true, maintenance: false })
    ).toMatchObject({
      failures: 1,
      blips: 0
    })
  })
  it('counts an unconfirmed failure as a blip', () => {
    expect(rollupDelta(check({ ok: false }), { confirmed: false, maintenance: false })).toMatchObject({
      failures: 0,
      blips: 1
    })
  })
  it('a failure during maintenance counts only as maintenance', () => {
    expect(rollupDelta(check({ ok: false }), { confirmed: true, maintenance: true })).toMatchObject({
      checks: 1,
      failures: 0,
      blips: 0,
      maintenance: 1
    })
  })
  it('no response time contributes nothing to response aggregates', () => {
    expect(
      rollupDelta(check({ ok: false, responseMs: null, statusCode: null }), {
        confirmed: true,
        maintenance: false
      })
    ).toMatchObject({
      respSum: 0,
      respCount: 0,
      respMax: 0
    })
  })
})

describe('rollup tables', () => {
  it('migration creates both tables and cascades on monitor delete', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await db.insert(schema.rollup30m).values({ monitorId: m.id, bucketStart: T0, checks: 1 })
    await db.insert(schema.rollupDaily).values({ monitorId: m.id, dayStart: T0, checks: 1 })
    const { eq } = await import('drizzle-orm')
    await db.delete(schema.monitors).where(eq(schema.monitors.id, m.id))
    expect(await db.select().from(schema.rollup30m)).toEqual([])
    expect(await db.select().from(schema.rollupDaily)).toEqual([])
  })
})
