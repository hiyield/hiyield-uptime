import { describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import * as repo from '../../server/engine/repo'
import { dayStart, rollupDelta } from '../../server/engine/rollup'
import { backfillRollups, pruneRollups } from '../../server/utils/rollups'
import { makeDb, seedMonitor, schema } from './_db'
import type { Db } from '../../server/utils/db'

const NOW = Date.UTC(2026, 9, 7, 12, 0)
const MIN = 60_000
const DAY = 86_400_000

type Spec = { at: number; ok: boolean; confirmed: boolean; maintenance: boolean; ms: number | null }

async function seedChecksAndLiveRollups(db: Db, monitorId: string, specs: Spec[]) {
  for (const s of specs) {
    await db.insert(schema.checks).values({
      monitorId,
      checkedAt: s.at,
      ok: s.ok,
      statusCode: s.ok ? 200 : 503,
      responseMs: s.ms,
      region: 'primary',
      confirmed: s.confirmed,
      maintenance: s.maintenance
    })
    // probe rows must be ignored by backfill
    if (!s.ok)
      await db.insert(schema.checks).values({
        monitorId,
        checkedAt: s.at,
        ok: false,
        responseMs: 999,
        region: 'probe',
        confirmed: s.confirmed,
        maintenance: s.maintenance
      })
    await repo.upsertRollups(
      db,
      monitorId,
      s.at,
      rollupDelta({ ok: s.ok, statusCode: null, responseMs: s.ms, error: null, checkedAt: s.at }, s)
    )
  }
}

const all = async (db: Db) => ({
  r30: await db
    .select()
    .from(schema.rollup30m)
    .orderBy(asc(schema.rollup30m.monitorId), asc(schema.rollup30m.bucketStart)),
  rd: await db
    .select()
    .from(schema.rollupDaily)
    .orderBy(asc(schema.rollupDaily.monitorId), asc(schema.rollupDaily.dayStart))
})

const specs: Spec[] = [
  { at: NOW - 3 * 60 * MIN, ok: true, confirmed: false, maintenance: false, ms: 100 },
  { at: NOW - 3 * 60 * MIN + 5 * MIN, ok: false, confirmed: true, maintenance: false, ms: 400 },
  { at: NOW - 2 * 60 * MIN, ok: false, confirmed: false, maintenance: false, ms: null },
  { at: NOW - 30 * MIN, ok: false, confirmed: true, maintenance: true, ms: 80 },
  { at: NOW - 2 * 86_400_000, ok: true, confirmed: false, maintenance: false, ms: 50 }
]

describe('backfillRollups', () => {
  it('rebuilds exactly what live writes produced', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await seedChecksAndLiveRollups(db, m.id, specs)
    const live = await all(db)
    await db.delete(schema.rollup30m)
    await db.delete(schema.rollupDaily)
    await backfillRollups(db, NOW)
    expect(await all(db)).toEqual(live)
  })

  it('is idempotent', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await seedChecksAndLiveRollups(db, m.id, specs)
    await backfillRollups(db, NOW)
    const first = await all(db)
    await backfillRollups(db, NOW)
    expect(await all(db)).toEqual(first)
  })

  it('does nothing when there are no checks', async () => {
    const db = makeDb()
    expect(await backfillRollups(db, NOW)).toEqual({ from30m: null, fromDay: null })
  })

  it('only rebuilds 30-minute rows inside their retention window', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await seedChecksAndLiveRollups(db, m.id, [
      { at: NOW - 20 * 86_400_000, ok: true, confirmed: false, maintenance: false, ms: 10 }
    ])
    await db.delete(schema.rollup30m)
    await backfillRollups(db, NOW)
    expect(await db.select().from(schema.rollup30m)).toEqual([])
    expect(await db.select().from(schema.rollupDaily)).toHaveLength(1)
  })
})

describe('backfillRollups — oldest day', () => {
  it('fills in a rollup_daily row for the oldest day on first backfill (no prior rollups)', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    // Oldest check mid-day (not on a day boundary), ~89 days before NOW — simulates the first
    // backfill after deploying this release, against raw checks kept at a rolling ~90-day retention.
    const oldest = NOW - 89 * DAY - 5 * MIN
    await db.insert(schema.checks).values({
      monitorId: m.id,
      checkedAt: oldest,
      ok: true,
      statusCode: 200,
      responseMs: 42,
      region: 'primary',
      confirmed: false,
      maintenance: false
    })

    await backfillRollups(db, NOW)

    const rows = await db
      .select()
      .from(schema.rollupDaily)
      .where(eq(schema.rollupDaily.dayStart, dayStart(oldest)))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      checks: 1,
      failures: 0,
      blips: 0,
      maintenance: 0,
      respSum: 42,
      respCount: 1,
      respMax: 42
    })
  })

  it('preserves an existing live oldest-day row untouched while rebuilding later days', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const oldestDay = dayStart(NOW) - 90 * DAY

    // Simulate a complete, live-written daily row for the oldest day, taken before raw-check
    // retention pruned most of that day's checks down to a remainder.
    await db.insert(schema.rollupDaily).values({
      monitorId: m.id,
      dayStart: oldestDay,
      checks: 500,
      failures: 10,
      blips: 2,
      maintenance: 1,
      respSum: 50_000,
      respCount: 480,
      respMax: 900
    })
    // Only a sliver of raw checks remain for that day — far short of what the live row recorded.
    await db.insert(schema.checks).values({
      monitorId: m.id,
      checkedAt: oldestDay + 60 * MIN,
      ok: true,
      statusCode: 200,
      responseMs: 10,
      region: 'primary',
      confirmed: false,
      maintenance: false
    })
    // A later day with full raw data and no existing rollup — must be rebuilt from scratch.
    const laterDay = oldestDay + 5 * DAY
    await db.insert(schema.checks).values([
      {
        monitorId: m.id,
        checkedAt: laterDay + 60 * MIN,
        ok: true,
        statusCode: 200,
        responseMs: 20,
        region: 'primary',
        confirmed: false,
        maintenance: false
      },
      {
        monitorId: m.id,
        checkedAt: laterDay + 120 * MIN,
        ok: false,
        statusCode: 503,
        responseMs: null,
        region: 'primary',
        confirmed: true,
        maintenance: false
      }
    ])

    await backfillRollups(db, NOW)

    const rows = await db.select().from(schema.rollupDaily).orderBy(asc(schema.rollupDaily.dayStart))
    const oldest = rows.find((r) => r.dayStart === oldestDay)
    const later = rows.find((r) => r.dayStart === laterDay)
    expect(oldest).toMatchObject({
      checks: 500,
      failures: 10,
      blips: 2,
      maintenance: 1,
      respSum: 50_000,
      respCount: 480,
      respMax: 900
    })
    expect(later).toMatchObject({
      checks: 2,
      failures: 1,
      blips: 0,
      maintenance: 0,
      respSum: 20,
      respCount: 1,
      respMax: 20
    })
  })
})

describe('pruneRollups', () => {
  it('drops 30-minute rows older than 8 days and daily rows older than 400 days', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await db.insert(schema.rollup30m).values([
      { monitorId: m.id, bucketStart: NOW - 9 * DAY, checks: 1 },
      { monitorId: m.id, bucketStart: NOW - 7 * DAY, checks: 1 }
    ])
    await db.insert(schema.rollupDaily).values([
      { monitorId: m.id, dayStart: NOW - 401 * DAY, checks: 1 },
      { monitorId: m.id, dayStart: NOW - 399 * DAY, checks: 1 }
    ])
    await pruneRollups(db, NOW)
    expect((await db.select().from(schema.rollup30m)).map((r) => r.bucketStart)).toEqual([NOW - 7 * DAY])
    expect((await db.select().from(schema.rollupDaily)).map((r) => r.dayStart)).toEqual([NOW - 399 * DAY])
  })
})
