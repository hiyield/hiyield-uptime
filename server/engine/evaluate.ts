import { SUSPECT_RETRY_MS } from '../../shared/utils/constants'
import type { Action, CheckResult, MonitorConfig, MonitorState } from './types'

export interface EvaluateInput {
  state: MonitorState
  config: MonitorConfig
  primary: CheckResult
  /** Result from ProbeDO; null when the primary check passed (probe not consulted). */
  probe: CheckResult | null
  inMaintenance: boolean
  now: number
  /** Pre-generated so this function stays pure; used only if an incident opens. */
  newIncidentId: string
}

export interface EvaluateResult {
  nextState: MonitorState
  actions: Action[]
  nextCheckAt: number
}

export function initialState(): MonitorState {
  return {
    status: 'unknown',
    consecutiveFailures: 0,
    firstFailureAt: null,
    openIncidentId: null,
    incidentConfirmedAt: null,
    lastReminderAt: null
  }
}

const upState = (): MonitorState => ({ ...initialState(), status: 'up' })

export function causeOf(check: CheckResult): string {
  return check.error ?? (check.statusCode ? `HTTP ${check.statusCode}` : 'Unknown error')
}

/** All alerting decisions. Pure: no I/O, no clock, no randomness. */
export function evaluate(input: EvaluateInput): EvaluateResult {
  const { state, config, primary, probe, inMaintenance, now } = input
  const normalNext = now + config.intervalS * 1000
  const actions: Action[] = []

  if (inMaintenance) {
    if (state.openIncidentId) {
      actions.push({ type: 'resolveIncident', incidentId: state.openIncidentId, resolvedAt: now })
    }
    return { nextState: upState(), actions, nextCheckAt: normalNext }
  }

  if (primary.ok) {
    if (state.status === 'down' && state.openIncidentId) {
      const downSince = state.firstFailureAt ?? state.incidentConfirmedAt ?? now
      actions.push({ type: 'resolveIncident', incidentId: state.openIncidentId, resolvedAt: now })
      actions.push({
        type: 'alert',
        kind: 'recovered',
        incidentId: state.openIncidentId,
        cause: null,
        downForMs: now - downSince
      })
    }
    return { nextState: upState(), actions, nextCheckAt: normalNext }
  }

  const confirmed = probe !== null && !probe.ok
  if (!confirmed) {
    return {
      nextState: state,
      actions,
      nextCheckAt: state.status === 'suspect' ? now + SUSPECT_RETRY_MS : normalNext
    }
  }

  const cause = causeOf(primary)
  const consecutiveFailures = state.consecutiveFailures + 1
  const firstFailureAt = state.firstFailureAt ?? now

  if (state.status === 'down' && state.openIncidentId) {
    const nextState: MonitorState = { ...state, consecutiveFailures, firstFailureAt }
    const lastNotified = state.lastReminderAt ?? state.incidentConfirmedAt ?? now
    if (config.reminderMins > 0 && now - lastNotified >= config.reminderMins * 60_000) {
      actions.push({
        type: 'alert',
        kind: 'reminder',
        incidentId: state.openIncidentId,
        cause,
        downForMs: now - firstFailureAt
      })
      actions.push({ type: 'markReminder', incidentId: state.openIncidentId, at: now })
      nextState.lastReminderAt = now
    }
    return { nextState, actions, nextCheckAt: normalNext }
  }

  if (consecutiveFailures >= config.failThreshold) {
    const incidentId = input.newIncidentId
    actions.push({ type: 'openIncident', incidentId, startedAt: firstFailureAt, confirmedAt: now, cause })
    actions.push({ type: 'alert', kind: 'down', incidentId, cause, downForMs: now - firstFailureAt })
    return {
      nextState: {
        status: 'down',
        consecutiveFailures,
        firstFailureAt,
        openIncidentId: incidentId,
        incidentConfirmedAt: now,
        lastReminderAt: null
      },
      actions,
      nextCheckAt: normalNext
    }
  }

  return {
    nextState: { ...state, status: 'suspect', consecutiveFailures, firstFailureAt },
    actions,
    nextCheckAt: now + SUSPECT_RETRY_MS
  }
}
