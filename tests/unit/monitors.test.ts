import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { monitorInputSchema, normaliseUrl } from '../../shared/utils/validation'
import { parseBulk } from '../../shared/utils/bulk'
import {
  createMonitor,
  defaultContactIds,
  getMonitorWithContacts,
  updateMonitor
} from '../../server/utils/monitors'
import { makeDb, seedContact, schema, T0 } from './_db'

const valid = {
  name: 'Acme',
  url: 'https://acme.example',
  intervalS: 300,
  timeoutMs: 10_000,
  failThreshold: 2,
  reminderMins: 30,
  paused: false,
  contactIds: []
}

describe('normaliseUrl', () => {
  it('trims and lowercases the scheme', () => {
    expect(normaliseUrl('  HTTPS://Acme.example/path?q=1  ')).toBe('https://acme.example/path?q=1')
  })
  it('rejects non-http(s) and garbage', () => {
    expect(normaliseUrl('ftp://acme.example')).toBeNull()
    expect(normaliseUrl('acme.example')).toBeNull()
    expect(normaliseUrl('')).toBeNull()
  })
})

describe('monitorInputSchema', () => {
  it('accepts a valid monitor and normalises the URL', () => {
    const r = monitorInputSchema.parse({ ...valid, url: ' https://acme.example ' })
    expect(r.url).toBe('https://acme.example/')
  })
  it('rejects intervals outside the allowed set', () => {
    expect(monitorInputSchema.safeParse({ ...valid, intervalS: 45 }).success).toBe(false)
  })
  it('rejects out-of-range timeout, threshold and reminder', () => {
    expect(monitorInputSchema.safeParse({ ...valid, timeoutMs: 500 }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, timeoutMs: 31_000 }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, failThreshold: 0 }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, failThreshold: 11 }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, reminderMins: 5 }).success).toBe(false)
  })
  it('rejects a blank name and a non-http URL', () => {
    expect(monitorInputSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false)
    expect(monitorInputSchema.safeParse({ ...valid, url: 'ftp://x' }).success).toBe(false)
  })
})

describe('parseBulk', () => {
  it('parses name, url lines with CRLF, blanks and comments', () => {
    const rows = parseBulk(
      '# clients\r\nAcme, https://acme.example\r\n\r\nBeta Ltd,https://beta.example/shop\r\n'
    )
    expect(rows).toEqual([
      { line: 2, name: 'Acme', url: 'https://acme.example/', error: null },
      { line: 4, name: 'Beta Ltd', url: 'https://beta.example/shop', error: null }
    ])
  })
  it('keeps commas inside the URL (splits on the first comma only)', () => {
    const [row] = parseBulk('Gamma, https://gamma.example/?a=1,2')
    expect(row).toMatchObject({ name: 'Gamma', url: 'https://gamma.example/?a=1,2', error: null })
  })
  it('flags bad lines without dropping good ones', () => {
    const rows = parseBulk(
      'no comma here\n, https://x.example\nDelta, not-a-url\nEcho, https://e.example\nEcho 2, https://e.example'
    )
    expect(rows.map((r) => r.error)).toEqual([
      'Expected: name, url',
      'Name is required',
      'Enter a full http:// or https:// URL',
      null,
      'Duplicate URL (line 4)'
    ])
  })
  it('flags URLs that are already monitored (compared after normalising)', () => {
    const rows = parseBulk('Acme, HTTPS://acme.example\nBeta, https://beta.example', [
      'https://acme.example/'
    ])
    expect(rows.map((r) => r.error)).toEqual(['Already monitored', null])
  })
})

describe('monitor persistence', () => {
  it('createMonitor stores the monitor and its contacts', async () => {
    const db = makeDb()
    const c = await seedContact(db)
    await createMonitor(db, monitorInputSchema.parse({ ...valid, contactIds: [c.id] }), T0, 'm1')
    const m = await getMonitorWithContacts(db, 'm1')
    expect(m).toMatchObject({
      id: 'm1',
      name: 'Acme',
      url: 'https://acme.example/',
      status: 'unknown',
      contactIds: [c.id]
    })
  })

  it('a paused monitor starts with status paused', async () => {
    const db = makeDb()
    await createMonitor(db, monitorInputSchema.parse({ ...valid, paused: true }), T0, 'm2')
    expect((await getMonitorWithContacts(db, 'm2'))!.status).toBe('paused')
  })

  it('updateMonitor replaces contacts and returns false for unknown ids', async () => {
    const db = makeDb()
    const a = await seedContact(db)
    const b = await seedContact(db)
    await createMonitor(db, monitorInputSchema.parse({ ...valid, contactIds: [a.id] }), T0, 'm3')
    const ok = await updateMonitor(
      db,
      'm3',
      monitorInputSchema.parse({ ...valid, name: 'Acme 2', contactIds: [b.id] }),
      T0 + 1
    )
    expect(ok).toBe(true)
    const m = await getMonitorWithContacts(db, 'm3')
    expect(m).toMatchObject({ name: 'Acme 2', contactIds: [b.id], updatedAt: T0 + 1 })
    expect(await updateMonitor(db, 'nope', monitorInputSchema.parse(valid), T0)).toBe(false)
  })

  it('defaultContactIds lists contacts flagged default', async () => {
    const db = makeDb()
    const a = await seedContact(db, { isDefault: true })
    await seedContact(db, { isDefault: false })
    expect(await defaultContactIds(db)).toEqual([a.id])
  })

  it('getMonitorWithContacts returns null for unknown ids', async () => {
    const db = makeDb()
    expect(await getMonitorWithContacts(db, 'nope')).toBeNull()
    expect(await db.select().from(schema.monitors).where(eq(schema.monitors.id, 'nope'))).toEqual([])
  })
})
