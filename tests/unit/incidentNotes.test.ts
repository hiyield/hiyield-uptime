import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { incidentNoteSchema } from '../../shared/utils/validation'
import { setIncidentNote } from '../../server/utils/incidents'
import { getHistory } from '../../server/utils/stats'
import { makeDb, seedMonitor, schema, T0 } from './_db'

describe('incidentNoteSchema', () => {
  it('trims and caps at 2000 characters', () => {
    expect(incidentNoteSchema.parse({ note: '  Host outage  ' }).note).toBe('Host outage')
    expect(incidentNoteSchema.safeParse({ note: 'x'.repeat(2001) }).success).toBe(false)
    expect(incidentNoteSchema.parse({ note: '' }).note).toBe('')
  })
})

describe('setIncidentNote', () => {
  it('stores note, author and time; returns false for an unknown incident', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await db
      .insert(schema.incidents)
      .values({ id: 'inc_1', monitorId: m.id, startedAt: T0, confirmedAt: T0, cause: 'HTTP 503' })

    expect(
      await setIncidentNote(db, 'inc_1', 'Kinsta outage, they fixed it', 'logan@hiyield.co.uk', T0 + 5)
    ).toBe(true)
    const row = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, 'inc_1') })
    expect(row).toMatchObject({
      note: 'Kinsta outage, they fixed it',
      noteBy: 'logan@hiyield.co.uk',
      noteAt: T0 + 5
    })

    expect(await setIncidentNote(db, 'nope', 'x', 'logan@hiyield.co.uk', T0)).toBe(false)
  })

  it('a new incident has an empty note and no author; history exposes the fields', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await db
      .insert(schema.incidents)
      .values({ id: 'inc_1', monitorId: m.id, startedAt: T0, confirmedAt: T0, cause: 'HTTP 503' })
    const h = await getHistory(db, m.id, T0 + 1)
    expect(h.incidents[0]).toMatchObject({ id: 'inc_1', note: '', noteBy: null, noteAt: null })
  })

  it('clearing a note keeps who cleared it', async () => {
    const db = makeDb()
    const m = await seedMonitor(db)
    await db
      .insert(schema.incidents)
      .values({ id: 'inc_1', monitorId: m.id, startedAt: T0, confirmedAt: T0, cause: 'HTTP 503' })
    await setIncidentNote(db, 'inc_1', 'wrong note', 'a@hiyield.co.uk', T0 + 1)
    await setIncidentNote(db, 'inc_1', '', 'b@hiyield.co.uk', T0 + 2)
    const row = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, 'inc_1') })
    expect(row).toMatchObject({ note: '', noteBy: 'b@hiyield.co.uk', noteAt: T0 + 2 })
  })
})
