import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { contactCreateSchema, maintenanceSchema } from '../../shared/utils/validation'
import { listContacts, maskTarget, updateContact } from '../../server/utils/contacts'
import { listMaintenance } from '../../server/utils/maintenance'
import { makeDb, seedContact, seedMonitor, schema, T0 } from './_db'

describe('contactCreateSchema', () => {
  it('accepts a Slack webhook and an email', () => {
    expect(
      contactCreateSchema.parse({
        type: 'slack',
        name: '#dev',
        target: ' https://hooks.slack.com/services/T/B/x '
      })
    ).toEqual({
      type: 'slack',
      name: '#dev',
      target: 'https://hooks.slack.com/services/T/B/x',
      isDefault: false
    })
    expect(
      contactCreateSchema.parse({
        type: 'email',
        name: 'Logan',
        target: 'logan@hiyield.co.uk',
        isDefault: true
      })
    ).toMatchObject({ type: 'email', isDefault: true })
  })
  it('rejects a non-Slack URL for slack and a bad email for email', () => {
    expect(
      contactCreateSchema.safeParse({ type: 'slack', name: 'x', target: 'https://evil.example/hook' }).success
    ).toBe(false)
    expect(contactCreateSchema.safeParse({ type: 'email', name: 'x', target: 'not-an-email' }).success).toBe(
      false
    )
    expect(contactCreateSchema.safeParse({ type: 'sms', name: 'x', target: '+447700900000' }).success).toBe(
      false
    )
  })
})

describe('maintenanceSchema', () => {
  it('requires end after start', () => {
    const r = maintenanceSchema.safeParse({ monitorId: null, startsAt: T0, endsAt: T0 })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.message).toBe('End must be after start')
  })
  it('accepts a global window with a default note', () => {
    expect(maintenanceSchema.parse({ monitorId: null, startsAt: T0, endsAt: T0 + 1 })).toEqual({
      monitorId: null,
      startsAt: T0,
      endsAt: T0 + 1,
      note: ''
    })
  })
})

describe('maskTarget', () => {
  it('masks Slack webhooks but not emails', () => {
    expect(maskTarget('slack', 'https://hooks.slack.com/services/T/B/abcdef123456')).toBe('…123456')
    expect(maskTarget('email', 'a@hiyield.co.uk')).toBe('a@hiyield.co.uk')
  })
})

describe('listContacts', () => {
  it('lists contacts with masked targets, linked monitors and the latest delivery', async () => {
    const db = makeDb()
    const m = await seedMonitor(db, { name: 'Acme' })
    const c = await seedContact(db, {
      name: 'Dev Slack',
      target: 'https://hooks.slack.com/services/T/B/zzzzzz999999'
    })
    await seedContact(db, { name: 'Idle', type: 'email', target: 'idle@hiyield.co.uk' })
    await db.insert(schema.monitorContacts).values({ monitorId: m.id, contactId: c.id })
    await db.insert(schema.alertDeliveries).values([
      { id: 'd1', contactId: c.id, kind: 'test', attempt: 1, ok: true, sentAt: T0 },
      {
        id: 'd2',
        contactId: c.id,
        kind: 'test',
        attempt: 1,
        ok: false,
        error: 'Slack responded 404: no_service',
        sentAt: T0 + 5
      }
    ])
    const list = await listContacts(db)
    const dev = list.find((x) => x.name === 'Dev Slack')!
    expect(dev).toMatchObject({
      targetMasked: '…999999',
      monitors: [{ id: m.id, name: 'Acme' }],
      lastDelivery: { ok: false, at: T0 + 5, error: 'Slack responded 404: no_service' }
    })
    expect(list.find((x) => x.name === 'Idle')).toMatchObject({ monitors: [], lastDelivery: null })
    expect(JSON.stringify(list)).not.toContain('zzzzzz')
  })
})

describe('updateContact', () => {
  it('keeps the existing target when none is given', async () => {
    const db = makeDb()
    const c = await seedContact(db)
    expect(await updateContact(db, c.id, { name: 'Renamed', isDefault: true, target: '' })).toEqual({
      ok: true
    })
    const row = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, c.id) })
    expect(row).toMatchObject({ name: 'Renamed', isDefault: true, target: c.target })
  })
  it('validates a new target against the contact type', async () => {
    const db = makeDb()
    const c = await seedContact(db)
    const r = await updateContact(db, c.id, { name: 'x', isDefault: false, target: 'someone@hiyield.co.uk' })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })
  it('404s for unknown contacts', async () => {
    const db = makeDb()
    expect(await updateContact(db, 'nope', { name: 'x', isDefault: false })).toMatchObject({
      ok: false,
      status: 404
    })
  })
})

describe('listMaintenance', () => {
  it('shows recent and upcoming windows with the monitor name, newest first', async () => {
    const db = makeDb()
    const m = await seedMonitor(db, { name: 'Acme' })
    const DAY = 86_400_000
    const row = (id: string, monitorId: string | null, startsAt: number, endsAt: number) => ({
      id,
      monitorId,
      startsAt,
      endsAt,
      createdBy: 'a@hiyield.co.uk',
      createdAt: T0
    })
    await db
      .insert(schema.maintenanceWindows)
      .values([
        row('old', m.id, T0 - 60 * DAY, T0 - 59 * DAY),
        row('recent', m.id, T0 - 2 * DAY, T0 - DAY),
        row('next', null, T0 + DAY, T0 + 2 * DAY)
      ])
    const list = await listMaintenance(db, T0)
    expect(list.map((w) => [w.id, w.monitorName])).toEqual([
      ['next', null],
      ['recent', 'Acme']
    ])
  })
})
