import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeDb, seedContact, seedMonitor, schema, T0 } from './_db'

describe('schema', () => {
  it('applies migrations and fills monitor defaults', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, m.id) })
    expect(row).toMatchObject({
      intervalS: 300,
      timeoutMs: 10000,
      failThreshold: 2,
      reminderMins: 30,
      paused: false,
      status: 'unknown',
      consecutiveFailures: 0,
      lastCheckedAt: null
    })
  })

  it('rejects unknown contact types', async () => {
    const db = makeDb()
    await expect(seedContact(db, { type: 'sms' as never })).rejects.toThrow()
  })

  it('cascade delete: removing a monitor removes its history and links', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c = await seedContact(db)
    await db.insert(schema.monitorContacts).values({ monitorId: m.id, contactId: c.id })
    await db.insert(schema.checks).values({ monitorId: m.id, checkedAt: T0, ok: false, region: 'primary' })
    await db
      .insert(schema.incidents)
      .values({ id: 'inc_1', monitorId: m.id, startedAt: T0, confirmedAt: T0, cause: 'HTTP 503' })
    await db.insert(schema.alertDeliveries).values({
      id: 'del_1',
      incidentId: 'inc_1',
      monitorId: m.id,
      contactId: c.id,
      kind: 'down',
      attempt: 1,
      ok: true,
      sentAt: T0
    })
    await db.insert(schema.maintenanceWindows).values({
      id: 'mw_1',
      monitorId: m.id,
      startsAt: T0,
      endsAt: T0 + 1,
      createdBy: 'a@hiyield.co.uk',
      createdAt: T0
    })

    await db.delete(schema.monitors).where(eq(schema.monitors.id, m.id))

    expect(await db.select().from(schema.checks)).toHaveLength(0)
    expect(await db.select().from(schema.incidents)).toHaveLength(0)
    expect(await db.select().from(schema.alertDeliveries)).toHaveLength(0)
    expect(await db.select().from(schema.monitorContacts)).toHaveLength(0)
    expect(await db.select().from(schema.maintenanceWindows)).toHaveLength(0)
    expect(await db.select().from(schema.contacts)).toHaveLength(1)
  })

  it('cascade delete: removing a contact removes its links and deliveries', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    const c = await seedContact(db)
    await db.insert(schema.monitorContacts).values({ monitorId: m.id, contactId: c.id })
    await db.insert(schema.alertDeliveries).values({
      id: 'del_2',
      contactId: c.id,
      kind: 'test',
      attempt: 1,
      ok: false,
      error: 'Slack responded 404',
      sentAt: T0
    })
    await db.delete(schema.contacts).where(eq(schema.contacts.id, c.id))
    expect(await db.select().from(schema.monitorContacts)).toHaveLength(0)
    expect(await db.select().from(schema.alertDeliveries)).toHaveLength(0)
    expect(await db.select().from(schema.monitors)).toHaveLength(1)
  })
})
