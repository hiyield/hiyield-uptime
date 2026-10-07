import { describe, expect, it } from 'vitest'
import { evaluate, initialState, type EvaluateInput } from '../../server/engine/evaluate'
import type { CheckResult, MonitorConfig, MonitorState } from '../../server/engine/types'

const NOW = 1_700_000_000_000
const MIN = 60_000

const cfg = (o: Partial<MonitorConfig> = {}): MonitorConfig => ({
  id: 'mon_1',
  name: 'Acme',
  url: 'https://acme.example/',
  intervalS: 300,
  timeoutMs: 10_000,
  failThreshold: 2,
  reminderMins: 30,
  paused: false,
  ...o
})

const ok = (): CheckResult => ({ ok: true, statusCode: 200, responseMs: 120, error: null, checkedAt: NOW })
const fail = (error = 'HTTP 503', statusCode: number | null = 503): CheckResult => ({
  ok: false,
  statusCode,
  responseMs: statusCode ? 80 : null,
  error,
  checkedAt: NOW
})

const st = (o: Partial<MonitorState> = {}): MonitorState => ({ ...initialState(), status: 'up', ...o })

const down = (o: Partial<MonitorState> = {}): MonitorState =>
  st({
    status: 'down',
    consecutiveFailures: 2,
    firstFailureAt: NOW - 20 * MIN,
    openIncidentId: 'inc_1',
    incidentConfirmedAt: NOW - 19 * MIN,
    ...o
  })

function run(o: Partial<EvaluateInput>) {
  return evaluate({
    state: st(),
    config: cfg(),
    primary: ok(),
    probe: null,
    inMaintenance: false,
    now: NOW,
    newIncidentId: 'inc_new',
    ...o
  })
}

describe('evaluate — healthy', () => {
  it('unknown + ok → up, no actions, normal interval', () => {
    const r = run({ state: initialState() })
    expect(r.nextState.status).toBe('up')
    expect(r.actions).toEqual([])
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })

  it('suspect + ok → up, counter reset, no alert', () => {
    const r = run({ state: st({ status: 'suspect', consecutiveFailures: 1, firstFailureAt: NOW - MIN }) })
    expect(r.nextState).toEqual({ ...initialState(), status: 'up' })
    expect(r.actions).toEqual([])
  })
})

describe('evaluate — blips', () => {
  it('up + primary fail + probe ok → unchanged, no actions, normal interval', () => {
    const state = st()
    const r = run({ state, primary: fail(), probe: ok() })
    expect(r.nextState).toEqual(state)
    expect(r.actions).toEqual([])
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })

  it('suspect + blip → stays suspect on the 30s cadence', () => {
    const state = st({ status: 'suspect', consecutiveFailures: 1, firstFailureAt: NOW - 30_000 })
    const r = run({ state, primary: fail(), probe: ok() })
    expect(r.nextState).toEqual(state)
    expect(r.nextCheckAt).toBe(NOW + 30_000)
  })

  it('down + blip → stays down, no actions', () => {
    const state = down()
    const r = run({ state, primary: fail(), probe: ok() })
    expect(r.nextState).toEqual(state)
    expect(r.actions).toEqual([])
  })
})

describe('evaluate — confirmed failures', () => {
  it('up + confirmed, threshold 2 → suspect, retry in 30s, no alert', () => {
    const r = run({ primary: fail(), probe: fail() })
    expect(r.nextState).toMatchObject({ status: 'suspect', consecutiveFailures: 1, firstFailureAt: NOW })
    expect(r.actions).toEqual([])
    expect(r.nextCheckAt).toBe(NOW + 30_000)
  })

  it('suspect + confirmed reaching threshold → down, incident opened, down alert', () => {
    const firstFailureAt = NOW - 30_000
    const r = run({
      state: st({ status: 'suspect', consecutiveFailures: 1, firstFailureAt }),
      primary: fail(),
      probe: fail()
    })
    expect(r.nextState).toEqual({
      status: 'down',
      consecutiveFailures: 2,
      firstFailureAt,
      openIncidentId: 'inc_new',
      incidentConfirmedAt: NOW,
      lastReminderAt: null
    })
    expect(r.actions).toEqual([
      {
        type: 'openIncident',
        incidentId: 'inc_new',
        startedAt: firstFailureAt,
        confirmedAt: NOW,
        cause: 'HTTP 503'
      },
      { type: 'alert', kind: 'down', incidentId: 'inc_new', cause: 'HTTP 503', downForMs: 30_000 }
    ])
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })

  it('threshold 1 → down on the first confirmed failure', () => {
    const r = run({ config: cfg({ failThreshold: 1 }), primary: fail(), probe: fail() })
    expect(r.nextState.status).toBe('down')
    expect(r.actions.map((a) => a.type)).toEqual(['openIncident', 'alert'])
  })

  it('site already down when the monitor is created (unknown, threshold 1) → down', () => {
    const r = run({
      state: initialState(),
      config: cfg({ failThreshold: 1 }),
      primary: fail(),
      probe: fail()
    })
    expect(r.nextState.status).toBe('down')
  })

  it('threshold 3 needs three confirmed failures', () => {
    const config = cfg({ failThreshold: 3 })
    const r1 = run({ config, primary: fail(), probe: fail() })
    const r2 = run({ config, state: r1.nextState, primary: fail(), probe: fail() })
    expect(r2.nextState.status).toBe('suspect')
    const r3 = run({ config, state: r2.nextState, primary: fail(), probe: fail() })
    expect(r3.nextState.status).toBe('down')
  })

  it('uses the error text as the cause (timeouts)', () => {
    const r = run({
      config: cfg({ failThreshold: 1 }),
      primary: fail('Timeout after 10s', null),
      probe: fail('Timeout after 10s', null)
    })
    expect(r.actions[0]).toMatchObject({ type: 'openIncident', cause: 'Timeout after 10s' })
  })
})

describe('evaluate — reminders', () => {
  it('no reminder before reminderMins since confirmation', () => {
    const r = run({ state: down({ incidentConfirmedAt: NOW - 10 * MIN }), primary: fail(), probe: fail() })
    expect(r.actions).toEqual([])
    expect(r.nextState.consecutiveFailures).toBe(3)
  })

  it('reminder at reminderMins since confirmation', () => {
    const r = run({ state: down({ incidentConfirmedAt: NOW - 30 * MIN }), primary: fail(), probe: fail() })
    expect(r.actions).toEqual([
      { type: 'alert', kind: 'reminder', incidentId: 'inc_1', cause: 'HTTP 503', downForMs: 20 * MIN },
      { type: 'markReminder', incidentId: 'inc_1', at: NOW }
    ])
    expect(r.nextState.lastReminderAt).toBe(NOW)
  })

  it('next reminder counts from the last reminder', () => {
    const state = down({ incidentConfirmedAt: NOW - 90 * MIN, lastReminderAt: NOW - 20 * MIN })
    expect(run({ state, primary: fail(), probe: fail() }).actions).toEqual([])
    const later = down({ incidentConfirmedAt: NOW - 90 * MIN, lastReminderAt: NOW - 30 * MIN })
    expect(run({ state: later, primary: fail(), probe: fail() }).actions[0]).toMatchObject({
      kind: 'reminder'
    })
  })

  it('reminderMins 0 never reminds', () => {
    const r = run({
      config: cfg({ reminderMins: 0 }),
      state: down({ incidentConfirmedAt: NOW - 600 * MIN }),
      primary: fail(),
      probe: fail()
    })
    expect(r.actions).toEqual([])
  })
})

describe('evaluate — recovery', () => {
  it('down + ok → incident resolved and recovered alert with downtime', () => {
    const r = run({ state: down() })
    expect(r.actions).toEqual([
      { type: 'resolveIncident', incidentId: 'inc_1', resolvedAt: NOW },
      { type: 'alert', kind: 'recovered', incidentId: 'inc_1', cause: null, downForMs: 20 * MIN }
    ])
    expect(r.nextState).toEqual({ ...initialState(), status: 'up' })
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })
})

describe('evaluate — maintenance', () => {
  it('failures during maintenance never alert or open incidents', () => {
    const r = run({ inMaintenance: true, primary: fail(), probe: fail(), config: cfg({ failThreshold: 1 }) })
    expect(r.actions).toEqual([])
    expect(r.nextState).toEqual({ ...initialState(), status: 'up' })
    expect(r.nextCheckAt).toBe(NOW + 300_000)
  })

  it('maintenance starting mid-incident resolves it silently', () => {
    const r = run({ inMaintenance: true, state: down(), primary: fail(), probe: fail() })
    expect(r.actions).toEqual([{ type: 'resolveIncident', incidentId: 'inc_1', resolvedAt: NOW }])
  })
})
