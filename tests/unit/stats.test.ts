import { describe, expect, it } from 'vitest'
import {
  DAY,
  findStaleMonitors,
  getHistory,
  listBoard,
  pruneChecks,
  responseSeries,
  uptimeByMonitor,
  uptimeFor,
  uptimePercent
} from '../../server/utils/stats'
import { makeDb, seedContact, seedMonitor, schema, T0 } from './_db'
import type { Db } from '../../server/utils/db'

const check = (db: Db, monitorId: string, o: Partial<typeof schema.checks.$inferInsert> = {}) =>
  db
    .insert(schema.checks)
    .values({ monitorId, checkedAt: T0, ok: true, region: 'primary', responseMs: 100, ...o })

describe('uptimePercent', () => {
  it('handles empty and rounds to 2dp', () => {
    expect(uptimePercent(0, 0)).toBeNull()
    expect(uptimePercent(3, 1)).toBe(66.67)
    expect(uptimePercent(288, 0)).toBe(100)
  })
})

describe('uptime queries', () => {
  it('counts only confirmed primary failures outside maintenance', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await check(db, m.id) // up
    await check(db, m.id, { ok: false, confirmed: true }) // real failure
    await check(db, m.id, { ok: false, confirmed: false }) // blip → not a failure
    await check(db, m.id, { ok: false, confirmed: true, region: 'probe' }) // probe row → ignored
    await check(db, m.id, { ok: false, confirmed: true, maintenance: true }) // maintenance → ignored
    await check(db, m.id, { checkedAt: T0 - 2 * DAY, ok: false, confirmed: true }) // too old
    expect(await uptimeFor(db, m.id, T0 - DAY)).toBe(66.67)
    const all = await uptimeByMonitor(db, T0 - DAY)
    expect(all.get(m.id)).toBe(66.67)
  })
})

describe('responseSeries', () => {
  it('averages response time per bucket, oldest first', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const B = 300_000
    const base = Math.floor(T0 / B) * B
    await check(db, m.id, { checkedAt: base + 1000, responseMs: 100 })
    await check(db, m.id, { checkedAt: base + 2000, responseMs: 200 })
    await check(db, m.id, { checkedAt: base + B + 1000, responseMs: 50 })
    await check(db, m.id, { checkedAt: base + B + 2000, ok: false, responseMs: null }) // no timing → skipped
    expect(await responseSeries(db, m.id, base - 1, B)).toEqual([
      { t: base, avgMs: 150 },
      { t: base + B, avgMs: 50 }
    ])
  })
})

describe('listBoard', () => {
  it('sorts down first, includes downSince, uptime and maintenance flags', async () => {
    const db = makeDb()
    const up = await seedMonitor(db, { name: 'A up', status: 'up' })
    const down = await seedMonitor(db, { name: 'Z down', status: 'down' })
    const paused = await seedMonitor(db, { name: 'B paused', status: 'paused', paused: true })
    await db.insert(schema.incidents).values({
      id: 'i1',
      monitorId: down.id,
      startedAt: T0 - 600_000,
      confirmedAt: T0 - 570_000,
      cause: 'HTTP 503'
    })
    await check(db, up.id)
    await db.insert(schema.maintenanceWindows).values({
      id: 'w1',
      monitorId: null,
      startsAt: T0 - 1,
      endsAt: T0 + 1,
      createdBy: 'a@hiyield.co.uk',
      createdAt: T0
    })
    const rows = await listBoard(db, T0)
    expect(rows.map((r) => r.name)).toEqual(['Z down', 'A up', 'B paused'])
    expect(rows[0]).toMatchObject({ downSince: T0 - 600_000, inMaintenance: true })
    expect(rows[1]).toMatchObject({ uptime24h: 100, downSince: null })
    expect(rows[2]!.id).toBe(paused.id)
  })
})

describe('findStaleMonitors', () => {
  const base = { paused: false, createdAt: T0 - DAY }
  it('flags monitors overdue by more than 2× interval (min 2 minutes)', () => {
    expect(
      findStaleMonitors(
        [
          { ...base, id: 'fresh', intervalS: 300, lastCheckedAt: T0 - 500_000 },
          { ...base, id: 'stale', intervalS: 300, lastCheckedAt: T0 - 601_000 },
          { ...base, id: 'fast-ok', intervalS: 30, lastCheckedAt: T0 - 110_000 },
          { ...base, id: 'fast-stale', intervalS: 30, lastCheckedAt: T0 - 121_000 },
          { ...base, id: 'paused', paused: true, intervalS: 30, lastCheckedAt: T0 - DAY },
          { ...base, id: 'never', intervalS: 300, lastCheckedAt: null }
        ],
        T0
      )
    ).toEqual(['stale', 'fast-stale', 'never'])
  })
  it('uses createdAt for monitors that have not run yet', () => {
    expect(
      findStaleMonitors(
        [{ id: 'new', intervalS: 300, paused: false, lastCheckedAt: null, createdAt: T0 - 1000 }],
        T0
      )
    ).toEqual([])
  })
})

describe('pruneChecks', () => {
  it('deletes checks older than the cutoff', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await check(db, m.id, { checkedAt: T0 - 91 * DAY })
    await check(db, m.id, { checkedAt: T0 })
    await pruneChecks(db, T0 - 90 * DAY)
    expect(await db.select().from(schema.checks)).toHaveLength(1)
  })
})

describe('getHistory', () => {
  it('returns uptime, series and recent records for one monitor', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c = await seedContact(db, { name: 'Dev Slack' })
    await check(db, m.id)
    await db
      .insert(schema.incidents)
      .values({ id: 'i1', monitorId: m.id, startedAt: T0, confirmedAt: T0, cause: 'x' })
    await db.insert(schema.alertDeliveries).values({
      id: 'd1',
      incidentId: 'i1',
      monitorId: m.id,
      contactId: c.id,
      kind: 'down',
      attempt: 1,
      ok: true,
      sentAt: T0
    })
    const h = await getHistory(db, m.id, T0 + 1)
    expect(h.uptime).toEqual({ h24: 100, d7: 100, d30: 100 })
    expect(h.series.h24).toHaveLength(1)
    expect(h.incidents.map((i) => i.id)).toEqual(['i1'])
    expect(h.checks).toHaveLength(1)
    expect(h.deliveries[0]).toMatchObject({ contactName: 'Dev Slack', kind: 'down', ok: true })
    expect(h.maintenance).toEqual([])
  })
})
