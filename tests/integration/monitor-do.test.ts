import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../server/db/schema'
import type { MonitorDO } from '../../server/engine/MonitorDO'
import type { AlertEvent, CheckResult, Contact } from '../../server/engine/types'

const db = drizzle(env.DB, { schema })
// An hour in the FUTURE: alarms set during a test must not actually fire mid-test
// (a past alarm time fires immediately and would race the direct alarm() calls).
const T = Date.now() + 3_600_000
let clock = T

const res = (ok: boolean, statusCode: number | null = ok ? 200 : 503): CheckResult => ({
  ok,
  statusCode,
  responseMs: 42,
  error: ok ? null : `HTTP ${statusCode}`,
  checkedAt: clock
})

interface Harness {
  primary: CheckResult[]
  probe: CheckResult[]
  sent: { contact: Contact; event: AlertEvent }[]
  throwOnCheck?: boolean
}

const harness = (): Harness => ({ primary: [], probe: [], sent: [] })

async function seed(id: string, overrides: Partial<typeof schema.monitors.$inferInsert> = {}) {
  await db.insert(schema.monitors).values({
    id,
    name: `Site ${id}`,
    url: `https://${id}.example/`,
    createdAt: T,
    updatedAt: T,
    ...overrides
  })
  await db.insert(schema.contacts).values({
    id: `c_${id}`,
    name: 'Dev Slack',
    type: 'slack',
    target: 'https://hooks.slack.com/services/x',
    createdAt: T
  })
  await db.insert(schema.monitorContacts).values({ monitorId: id, contactId: `c_${id}` })
}

function withMonitor<R>(id: string, h: Harness, fn: (m: MonitorDO, state: DurableObjectState) => Promise<R>) {
  const stub = env.MONITOR.get(env.MONITOR.idFromName(id))
  return runInDurableObject(stub, async (instance: MonitorDO, state: DurableObjectState) => {
    instance.deps = {
      runCheck: async () => {
        if (h.throwOnCheck) throw new Error('boom')
        return h.primary.shift() ?? res(true)
      },
      probe: async () => h.probe.shift() ?? res(true),
      sendAlert: async (contact, event, onAttempt) => {
        h.sent.push({ contact, event })
        await onAttempt?.({ attempt: 1, ok: true, error: null })
        return { ok: true, attempts: 1, error: null }
      },
      now: () => clock,
      newId: () => crypto.randomUUID()
    }
    return fn(instance, state)
  })
}

const monitorRow = (id: string) => db.query.monitors.findFirst({ where: eq(schema.monitors.id, id) })

describe('MonitorDO', () => {
  it('reload schedules an immediate check; tick records it and reschedules at the interval', async () => {
    clock = T
    await seed('m1')
    const h = harness()
    await withMonitor('m1', h, async (m, state) => {
      await m.reload('m1')
      expect(await state.storage.getAlarm()).toBe(T)
      await m.alarm()
      expect(await state.storage.getAlarm()).toBe(T + 300_000)
    })
    expect(await monitorRow('m1')).toMatchObject({ status: 'up', lastCheckedAt: T, lastStatusCode: 200 })
    const rows = await db.select().from(schema.checks).where(eq(schema.checks.monitorId, 'm1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ok: true, region: 'primary', confirmed: false })
  })

  it('two confirmed failures open an incident and alert; recovery resolves and alerts', async () => {
    clock = T
    await seed('m2')
    const h = harness()
    h.primary.push(res(false), res(false), res(true))
    h.probe.push(res(false), res(false))
    await withMonitor('m2', h, async (m) => {
      await m.reload('m2')
      await m.alarm() // suspect
      clock += 30_000
      await m.alarm() // down
      clock += 600_000
      await m.alarm() // recovered
    })
    expect(h.sent.map((s) => s.event.kind)).toEqual(['down', 'recovered'])
    expect(h.sent[0]!.contact.id).toBe('c_m2')
    expect(h.sent[0]!.event.dashboardUrl).toBe('https://uptime.test/monitors/m2')
    expect(h.sent[1]!.event.downForMs).toBe(630_000)
    const incidents = await db.select().from(schema.incidents).where(eq(schema.incidents.monitorId, 'm2'))
    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({
      startedAt: T,
      confirmedAt: T + 30_000,
      resolvedAt: T + 630_000,
      cause: 'HTTP 503'
    })
    const deliveries = await db
      .select()
      .from(schema.alertDeliveries)
      .where(eq(schema.alertDeliveries.monitorId, 'm2'))
    expect(deliveries.map((d) => d.kind).sort()).toEqual(['down', 'recovered'])
    expect(await monitorRow('m2')).toMatchObject({ status: 'up' })
  })

  it('a blip is recorded unconfirmed and changes nothing', async () => {
    clock = T
    await seed('m3')
    const h = harness()
    h.primary.push(res(true), res(false))
    h.probe.push(res(true))
    await withMonitor('m3', h, async (m) => {
      await m.reload('m3')
      await m.alarm()
      clock += 300_000
      await m.alarm()
    })
    expect(h.sent).toEqual([])
    expect(await monitorRow('m3')).toMatchObject({ status: 'up' })
    // Primary blips (one failed check); the probe disagrees (still ok), so the failure
    // is recorded but unconfirmed on both regions and nothing else happens.
    const rows = await db.select().from(schema.checks).where(eq(schema.checks.monitorId, 'm3'))
    expect(rows.map((r) => [r.region, r.ok, r.confirmed])).toEqual([
      ['primary', true, false],
      ['primary', false, false],
      ['probe', true, false]
    ])
  })

  it('reload with a shorter interval pulls the next check earlier', async () => {
    clock = T
    await seed('m4')
    const h = harness()
    await withMonitor('m4', h, async (m, state) => {
      await m.reload('m4')
      await m.alarm()
      expect(await state.storage.getAlarm()).toBe(T + 300_000)
      await db.update(schema.monitors).set({ intervalS: 30 }).where(eq(schema.monitors.id, 'm4'))
      await m.reload('m4')
      expect(await state.storage.getAlarm()).toBe(T + 30_000)
    })
  })

  it('stop() while down resolves incident and clears state', async () => {
    clock = T
    await seed('m5', { failThreshold: 1 })
    const h = harness()
    h.primary.push(res(false))
    h.probe.push(res(false))
    await withMonitor('m5', h, async (m, state) => {
      await m.reload('m5')
      await m.alarm()
      clock += 1000
      await m.stop()
      expect(await state.storage.getAlarm()).toBeNull()
      expect(await state.storage.get('state')).toBeUndefined()
    })
    const [incident] = await db.select().from(schema.incidents).where(eq(schema.incidents.monitorId, 'm5'))
    expect(incident!.resolvedAt).toBe(T + 1000)
  })

  it('URL edited while down recovers on next ok check', async () => {
    clock = T
    await seed('m6', { failThreshold: 1 })
    const h = harness()
    h.primary.push(res(false), res(true))
    h.probe.push(res(false))
    await withMonitor('m6', h, async (m) => {
      await m.reload('m6')
      await m.alarm()
      await db
        .update(schema.monitors)
        .set({ url: 'https://new-host.example/' })
        .where(eq(schema.monitors.id, 'm6'))
      clock += 300_000
      await m.alarm()
    })
    expect(h.sent.map((s) => s.event.kind)).toEqual(['down', 'recovered'])
    expect(h.sent[1]!.event.monitor!.url).toBe('https://new-host.example/')
  })

  it('a paused monitor does not tick or reschedule', async () => {
    clock = T
    await seed('m7', { paused: true })
    const h = harness()
    await withMonitor('m7', h, async (m, state) => {
      await m.reload('m7')
      expect(await state.storage.getAlarm()).toBeNull()
      expect(await m.tick()).toBeNull()
    })
  })

  it('alarm() reschedules even when the tick throws', async () => {
    clock = T
    await seed('m8')
    const h = harness()
    h.throwOnCheck = true
    await withMonitor('m8', h, async (m, state) => {
      await m.reload('m8')
      await m.alarm()
      expect(await state.storage.getAlarm()).toBe(T + 60_000)
    })
  })

  it('serves its HTTP routes', async () => {
    clock = T
    // Paused, so /reload schedules nothing — this test uses the REAL deps and must not make network calls.
    await seed('m9', { paused: true })
    const stub = env.MONITOR.get(env.MONITOR.idFromName('m9'))
    const r = await stub.fetch('https://monitor/reload', {
      method: 'POST',
      body: JSON.stringify({ monitorId: 'm9' })
    })
    expect(r.status).toBe(200)
    expect((await stub.fetch('https://monitor/nope', { method: 'POST' })).status).toBe(404)
  })
})
