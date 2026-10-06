import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as repo from '../../server/engine/repo'
import { makeDb, seedContact, seedMonitor, schema, T0 } from './_db'

describe('repo', () => {
  it('getMonitor maps the row to config, null when missing', async () => {
    const db = makeDb()
    const m = await seedMonitor(db, { intervalS: 60, failThreshold: 1 })
    expect(await repo.getMonitor(db, m.id)).toEqual({
      id: m.id,
      name: m.name,
      url: m.url,
      intervalS: 60,
      timeoutMs: 10000,
      failThreshold: 1,
      reminderMins: 30,
      paused: false
    })
    expect(await repo.getMonitor(db, 'nope')).toBeNull()
  })

  it('isInMaintenance: site window, global window, past and future windows', async () => {
    const db = makeDb()
    const a = await seedMonitor(db)
    const b = await seedMonitor(db)
    const win = (id: string, monitorId: string | null, startsAt: number, endsAt: number) =>
      db.insert(schema.maintenanceWindows).values({
        id,
        monitorId,
        startsAt,
        endsAt,
        createdBy: 'x@hiyield.co.uk',
        createdAt: T0
      })
    await win('w1', a.id, T0 - 1000, T0 + 1000)
    expect(await repo.isInMaintenance(db, a.id, T0)).toBe(true)
    expect(await repo.isInMaintenance(db, b.id, T0)).toBe(false)
    expect(await repo.isInMaintenance(db, a.id, T0 + 1000)).toBe(false) // end is exclusive
    await win('w2', null, T0 + 5000, T0 + 9000)
    expect(await repo.isInMaintenance(db, b.id, T0 + 6000)).toBe(true) // global
    expect(await repo.isInMaintenance(db, b.id, T0 + 4999)).toBe(false) // not started
  })

  it('insertChecks writes rows and ignores an empty list', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await repo.insertChecks(db, [])
    await repo.insertChecks(db, [
      { monitorId: m.id, checkedAt: T0, ok: false, statusCode: 503, region: 'primary', confirmed: true },
      { monitorId: m.id, checkedAt: T0, ok: false, statusCode: 503, region: 'probe' }
    ])
    expect(await db.select().from(schema.checks)).toHaveLength(2)
  })

  it('incident lifecycle: insert, reminder, resolve once', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await repo.insertIncident(db, {
      id: 'i1',
      monitorId: m.id,
      startedAt: T0,
      confirmedAt: T0 + 30_000,
      cause: 'HTTP 503'
    })
    await repo.setIncidentReminder(db, 'i1', T0 + 60_000)
    await repo.resolveIncident(db, 'i1', T0 + 90_000)
    await repo.resolveIncident(db, 'i1', T0 + 999_999) // must not overwrite
    const row = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, 'i1') })
    expect(row).toMatchObject({ lastReminderAt: T0 + 60_000, resolvedAt: T0 + 90_000 })
  })

  it('resolveOpenIncidents closes only open incidents for that monitor', async () => {
    const db = makeDb()
    const a = await seedMonitor(db)
    const b = await seedMonitor(db)
    await repo.insertIncident(db, { id: 'ia', monitorId: a.id, startedAt: T0, confirmedAt: T0, cause: 'x' })
    await repo.insertIncident(db, { id: 'ib', monitorId: b.id, startedAt: T0, confirmedAt: T0, cause: 'x' })
    await repo.resolveOpenIncidents(db, a.id, T0 + 5)
    const rows = await db.select().from(schema.incidents)
    expect(rows.find((r) => r.id === 'ia')!.resolvedAt).toBe(T0 + 5)
    expect(rows.find((r) => r.id === 'ib')!.resolvedAt).toBeNull()
  })

  it('getContactsForMonitor returns only linked contacts', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c1 = await seedContact(db, { name: 'Dev Slack' })
    await seedContact(db, { name: 'Unlinked' })
    await db.insert(schema.monitorContacts).values({ monitorId: m.id, contactId: c1.id })
    expect(await repo.getContactsForMonitor(db, m.id)).toEqual([
      { id: c1.id, name: 'Dev Slack', type: 'slack', target: c1.target }
    ])
  })

  it('insertDelivery and updateMonitorStatus', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c = await seedContact(db)
    await repo.insertDelivery(db, {
      id: 'd1',
      monitorId: m.id,
      contactId: c.id,
      kind: 'down',
      attempt: 1,
      ok: true,
      sentAt: T0
    })
    await repo.updateMonitorStatus(db, m.id, {
      status: 'down',
      consecutiveFailures: 2,
      lastCheckedAt: T0,
      lastResponseMs: null,
      lastStatusCode: 503
    })
    const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, m.id) })
    expect(row).toMatchObject({
      status: 'down',
      consecutiveFailures: 2,
      lastCheckedAt: T0,
      lastStatusCode: 503
    })
    expect(await db.select().from(schema.alertDeliveries)).toHaveLength(1)
  })

  it('updateMonitorStatus never overwrites a paused row', async () => {
    const db = makeDb()
    const m = await seedMonitor(db, { paused: true, status: 'paused' })
    await repo.updateMonitorStatus(db, m.id, {
      status: 'down',
      consecutiveFailures: 1,
      lastCheckedAt: T0,
      lastResponseMs: null,
      lastStatusCode: 503
    })
    const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, m.id) })
    expect(row).toMatchObject({ paused: true, status: 'paused', consecutiveFailures: 0, lastCheckedAt: null })
  })
})
