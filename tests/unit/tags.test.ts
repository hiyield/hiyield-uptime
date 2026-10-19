import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { monitorInputSchema, normaliseTag, TAG_ERROR } from '../../shared/utils/validation'
import { createMonitor, getMonitorWithContacts, listTags, updateMonitor } from '../../server/utils/monitors'
import { listBoard } from '../../server/utils/stats'
import { makeDb, seedMonitor, schema, T0 } from './_db'

const valid = {
  name: 'Acme',
  url: 'https://acme.example',
  intervalS: 300,
  timeoutMs: 10_000,
  failThreshold: 2,
  reminderMins: 30,
  paused: false,
  contactIds: [],
  tags: []
}

describe('normaliseTag', () => {
  it('lowercases, trims and turns inner whitespace into hyphens', () => {
    expect(normaliseTag('  Acme Ltd ')).toBe('acme-ltd')
    expect(normaliseTag('WordPress')).toBe('wordpress')
    expect(normaliseTag('kinsta  uk')).toBe('kinsta-uk')
  })
  it('rejects empty, punctuation and over-long tags', () => {
    expect(normaliseTag('')).toBeNull()
    expect(normaliseTag('   ')).toBeNull()
    expect(normaliseTag('acme/ltd')).toBeNull()
    expect(normaliseTag('#wp')).toBeNull()
    expect(normaliseTag('-lead')).toBeNull()
    expect(normaliseTag('a'.repeat(31))).toBeNull()
    expect(normaliseTag('a'.repeat(30))).toBe('a'.repeat(30))
  })
})

describe('monitorInputSchema tags', () => {
  it('defaults to no tags and normalises + dedupes what it gets', () => {
    expect(monitorInputSchema.parse({ ...valid, tags: undefined }).tags).toEqual([])
    expect(monitorInputSchema.parse({ ...valid, tags: ['Kinsta', ' kinsta', 'WordPress'] }).tags).toEqual([
      'kinsta',
      'wordpress'
    ])
  })
  it('rejects invalid tags with a helpful message and caps the count', () => {
    const r = monitorInputSchema.safeParse({ ...valid, tags: ['ok', 'not/ok'] })
    expect(r.success).toBe(false)
    expect(r.success ? '' : r.error.issues[0]?.message).toBe(TAG_ERROR)
    const many = Array.from({ length: 11 }, (_, i) => `t${i}`)
    expect(monitorInputSchema.safeParse({ ...valid, tags: many }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, tags: many.slice(0, 10) }).success).toBe(true)
  })
})

describe('monitor tags persistence', () => {
  it('create stores tags, get returns them sorted, update replaces them', async () => {
    const db = makeDb()
    await createMonitor(db, { ...valid, tags: ['wordpress', 'kinsta'] }, T0, 'm1')
    expect((await getMonitorWithContacts(db, 'm1'))?.tags).toEqual(['kinsta', 'wordpress'])

    await updateMonitor(db, 'm1', { ...valid, tags: ['kinsta', 'retainer'] }, T0 + 1)
    expect((await getMonitorWithContacts(db, 'm1'))?.tags).toEqual(['kinsta', 'retainer'])

    await updateMonitor(db, 'm1', { ...valid, tags: [] }, T0 + 2)
    expect((await getMonitorWithContacts(db, 'm1'))?.tags).toEqual([])
  })

  it('listTags returns distinct tags with monitor counts, most used first then alphabetical', async () => {
    const db = makeDb()
    await createMonitor(db, { ...valid, url: 'https://a.example', tags: ['kinsta', 'wordpress'] }, T0, 'a')
    await createMonitor(db, { ...valid, url: 'https://b.example', tags: ['kinsta', 'craft'] }, T0, 'b')
    await createMonitor(db, { ...valid, url: 'https://c.example', tags: [] }, T0, 'c')
    expect(await listTags(db)).toEqual([
      { tag: 'kinsta', count: 2 },
      { tag: 'craft', count: 1 },
      { tag: 'wordpress', count: 1 }
    ])
  })

  it('board rows carry their tags', async () => {
    const db = makeDb()
    await createMonitor(db, { ...valid, url: 'https://a.example', tags: ['kinsta'] }, T0, 'a')
    const m = await seedMonitor(db)
    const rows = await listBoard(db, T0, { withUptime: false })
    expect(rows.find((r) => r.id === 'a')?.tags).toEqual(['kinsta'])
    expect(rows.find((r) => r.id === m.id)?.tags).toEqual([])
  })

  it('deleting a monitor removes its tag rows', async () => {
    const db = makeDb()
    await createMonitor(db, { ...valid, tags: ['kinsta'] }, T0, 'm1')
    await db.delete(schema.monitors).where(eq(schema.monitors.id, 'm1'))
    expect(await db.select().from(schema.monitorTags)).toHaveLength(0)
  })
})
