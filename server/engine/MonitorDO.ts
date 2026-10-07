import type { D1Database, DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { evaluate, initialState, type EvaluateResult } from './evaluate'
import { createSender, type SendAlert } from './notify'
import { probeCheck } from './probeClient'
import * as repo from './repo'
import { runCheck } from './runCheck'
import type { Action, CheckResult, MonitorConfig, MonitorState } from './types'

export interface EngineEnv {
  DB: D1Database
  PROBE: DurableObjectNamespace
  RESEND_API_KEY: string
  MAIL_FROM: string
  PUBLIC_BASE_URL: string
}

/** Everything with a side effect outside D1/storage. Replaced wholesale in integration tests. */
export interface MonitorDeps {
  runCheck(url: string, timeoutMs: number): Promise<CheckResult>
  probe(url: string, timeoutMs: number): Promise<CheckResult>
  sendAlert: SendAlert
  now(): number
  newId(): string
}

/** Retry delay when a tick blows up, so one bad tick can never stop a monitor. */
const CRASH_RETRY_MS = 60_000

/**
 * Thrown inside a tick when the monitor was paused or deleted while the tick was awaiting
 * outbound I/O (fetch/D1 release the DO input gate, so /stop or /destroy can run mid-tick).
 */
class TickAborted extends Error {
  constructor(readonly monitorId: string) {
    super('tick aborted: monitor paused or deleted')
  }
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[MonitorDO] ${label} failed:`, err instanceof Error ? err.message : err)
    return fallback
  }
}

/**
 * One instance per monitored site, named by monitor id (`idFromName(monitorId)`).
 * Storage: `monitorId` (string), `state` (MonitorState), `generation` (number, bumped by
 * stop() so an in-flight tick can tell it was paused). Config is re-read from D1 on every
 * tick, so dashboard edits apply on the next check without a message.
 */
export class MonitorDO {
  deps: MonitorDeps

  constructor(
    private ctx: DurableObjectState,
    private env: EngineEnv
  ) {
    this.deps = {
      runCheck: (url, timeoutMs) => runCheck(url, { timeoutMs }),
      probe: (url, timeoutMs) => probeCheck(env.PROBE, url, timeoutMs),
      sendAlert: createSender({
        fetch: (input, init) => fetch(input, init),
        resendApiKey: env.RESEND_API_KEY,
        mailFrom: env.MAIL_FROM
      }),
      now: () => Date.now(),
      newId: () => crypto.randomUUID()
    }
  }

  private get db() {
    return drizzle(this.env.DB, { schema })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Not found', { status: 404 })
    const { pathname } = new URL(request.url)
    const body = (await request.json().catch(() => ({}))) as { monitorId?: string }
    switch (pathname) {
      case '/reload':
        if (!body.monitorId) return new Response('monitorId required', { status: 400 })
        await this.reload(body.monitorId)
        break
      case '/stop':
        await this.stop()
        break
      case '/check-now':
        await this.checkNow()
        break
      case '/destroy':
        await this.destroy()
        break
      default:
        return new Response('Not found', { status: 404 })
    }
    return Response.json({ ok: true })
  }

  /** Called after any config change. A new interval applies from now, never later than already scheduled. */
  async reload(monitorId: string): Promise<void> {
    await this.ctx.storage.put('monitorId', monitorId)
    const config = await repo.getMonitor(this.db, monitorId)
    if (!config || config.paused) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    const now = this.deps.now()
    const existing = await this.ctx.storage.getAlarm()
    const next = existing === null ? now : Math.min(existing, now + config.intervalS * 1000)
    await this.ctx.storage.setAlarm(next)
  }

  /** Pause: no more checks; any open incident is closed silently so resuming starts clean. */
  async stop(): Promise<void> {
    await this.ctx.storage.put('generation', (await this.generation()) + 1)
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.delete('state')
    const monitorId = await this.ctx.storage.get<string>('monitorId')
    if (monitorId) await repo.resolveOpenIncidents(this.db, monitorId, this.deps.now())
  }

  async checkNow(): Promise<void> {
    if (await this.ctx.storage.get<string>('monitorId')) await this.ctx.storage.setAlarm(this.deps.now())
  }

  /** deleteAll() also removes `monitorId`, which is what an in-flight tick notices. */
  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  private async generation(): Promise<number> {
    return (await this.ctx.storage.get<number>('generation')) ?? 0
  }

  /**
   * Throws TickAborted if stop()/destroy() ran since the tick started. Storage reads keep the
   * input gate closed, so nothing can interleave between this check and the storage write after it.
   */
  private async assertCurrent(monitorId: string, generation: number): Promise<void> {
    const [id, gen] = await Promise.all([this.ctx.storage.get<string>('monitorId'), this.generation()])
    if (id !== monitorId || gen !== generation) throw new TickAborted(monitorId)
  }

  async alarm(): Promise<void> {
    let next: number | null = this.deps.now() + CRASH_RETRY_MS
    try {
      next = await this.tick()
    } catch (err) {
      console.error('[MonitorDO] tick crashed:', err instanceof Error ? err.stack : err)
    } finally {
      if (next !== null) await this.ctx.storage.setAlarm(next)
    }
  }

  /** One check cycle. Returns when to run next, or null to stop (monitor deleted or paused). */
  async tick(): Promise<number | null> {
    try {
      return await this.runTick()
    } catch (err) {
      if (!(err instanceof TickAborted)) throw err
      // An incident insert may have raced stop()'s resolve; pausing always leaves none open.
      await safe(
        'resolveOpenIncidents',
        () => repo.resolveOpenIncidents(this.db, err.monitorId, this.deps.now()),
        undefined
      )
      return null
    }
  }

  private async runTick(): Promise<number | null> {
    const monitorId = await this.ctx.storage.get<string>('monitorId')
    if (!monitorId) return null
    const generation = await this.generation()
    const db = this.db
    const config = await repo.getMonitor(db, monitorId)
    if (!config || config.paused) return null
    const current = () => this.assertCurrent(monitorId, generation)

    const primary = await this.deps.runCheck(config.url, config.timeoutMs)
    let probe: CheckResult | null = null
    if (!primary.ok) {
      try {
        probe = await this.deps.probe(config.url, config.timeoutMs)
      } catch (err) {
        // Fail towards alerting: if the probe is unreachable we cannot call it a blip.
        probe = {
          ok: false,
          statusCode: null,
          responseMs: null,
          error: `Probe unavailable: ${err instanceof Error ? err.message : String(err)}`,
          checkedAt: this.deps.now()
        }
      }
    }

    const now = this.deps.now()
    const inMaintenance = await safe('isInMaintenance', () => repo.isInMaintenance(db, monitorId, now), false)
    // The checks above can take seconds; the pause route flips D1 before calling /stop, and
    // delete removes the row after /destroy, so re-check both D1 and storage before any write.
    const latest = await repo.getMonitor(db, monitorId)
    if (!latest || latest.paused) return null
    await current()
    const state = (await this.ctx.storage.get<MonitorState>('state')) ?? initialState()
    const result = evaluate({
      state,
      config,
      primary,
      probe,
      inMaintenance,
      now,
      newIncidentId: this.deps.newId()
    })
    await this.ctx.storage.put('state', result.nextState)

    const confirmed = !primary.ok && probe !== null && !probe.ok
    await safe(
      'insertChecks',
      () =>
        repo.insertChecks(db, [
          { monitorId, ...checkRow(primary), region: 'primary', confirmed, maintenance: inMaintenance },
          ...(probe
            ? [
                {
                  monitorId,
                  ...checkRow(probe),
                  region: 'probe' as const,
                  confirmed,
                  maintenance: inMaintenance
                }
              ]
            : [])
        ]),
      undefined
    )

    await this.execute(config, result, current)

    await current()
    await safe(
      'updateMonitorStatus',
      () =>
        repo.updateMonitorStatus(db, monitorId, {
          status: result.nextState.status,
          consecutiveFailures: result.nextState.consecutiveFailures,
          lastCheckedAt: primary.checkedAt,
          lastResponseMs: primary.responseMs,
          lastStatusCode: primary.statusCode
        }),
      undefined
    )
    // Last check before alarm() re-arms: a pause that landed during the D1 write must win.
    await current()
    return result.nextCheckAt
  }

  private async execute(
    config: MonitorConfig,
    result: EvaluateResult,
    current: () => Promise<void>
  ): Promise<void> {
    const db = this.db
    for (const action of result.actions) {
      await current()
      switch (action.type) {
        case 'openIncident':
          await safe(
            'insertIncident',
            () =>
              repo.insertIncident(db, {
                id: action.incidentId,
                monitorId: config.id,
                startedAt: action.startedAt,
                confirmedAt: action.confirmedAt,
                cause: action.cause
              }),
            undefined
          )
          break
        case 'resolveIncident':
          await safe(
            'resolveIncident',
            () => repo.resolveIncident(db, action.incidentId, action.resolvedAt),
            undefined
          )
          break
        case 'markReminder':
          await safe(
            'setIncidentReminder',
            () => repo.setIncidentReminder(db, action.incidentId, action.at),
            undefined
          )
          break
        case 'alert':
          await this.alert(config, action)
          break
      }
    }
  }

  private async alert(config: MonitorConfig, action: Extract<Action, { type: 'alert' }>): Promise<void> {
    const db = this.db
    const contacts = await safe('getContactsForMonitor', () => repo.getContactsForMonitor(db, config.id), [])
    const event = {
      kind: action.kind,
      monitor: { id: config.id, name: config.name, url: config.url },
      cause: action.cause,
      downForMs: action.downForMs,
      dashboardUrl: `${this.env.PUBLIC_BASE_URL}/monitors/${config.id}`
    }
    await Promise.all(
      contacts.map((contact) =>
        this.deps.sendAlert(contact, event, (attempt) =>
          safe(
            'insertDelivery',
            () =>
              repo.insertDelivery(db, {
                id: this.deps.newId(),
                incidentId: action.incidentId,
                monitorId: config.id,
                contactId: contact.id,
                kind: action.kind,
                attempt: attempt.attempt,
                ok: attempt.ok,
                error: attempt.error,
                sentAt: this.deps.now()
              }),
            undefined
          )
        )
      )
    )
  }
}

function checkRow(c: CheckResult) {
  return {
    checkedAt: c.checkedAt,
    ok: c.ok,
    statusCode: c.statusCode,
    responseMs: c.responseMs,
    error: c.error
  }
}
