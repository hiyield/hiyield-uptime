import type { MonitorStatus } from '../../shared/utils/status'

export type { MonitorStatus }

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface CheckResult {
  ok: boolean
  statusCode: number | null
  responseMs: number | null
  error: string | null
  checkedAt: number
}

export interface MonitorConfig {
  id: string
  name: string
  url: string
  intervalS: number
  timeoutMs: number
  failThreshold: number
  reminderMins: number
  paused: boolean
}

/** Persisted in MonitorDO storage under the key `state`. */
export interface MonitorState {
  status: MonitorStatus
  consecutiveFailures: number
  firstFailureAt: number | null
  openIncidentId: string | null
  incidentConfirmedAt: number | null
  lastReminderAt: number | null
}

export type Action =
  | { type: 'openIncident'; incidentId: string; startedAt: number; confirmedAt: number; cause: string }
  | { type: 'resolveIncident'; incidentId: string; resolvedAt: number }
  | { type: 'markReminder'; incidentId: string; at: number }
  | {
      type: 'alert'
      kind: 'down' | 'reminder' | 'recovered'
      incidentId: string
      cause: string | null
      downForMs: number
    }

export interface Contact {
  id: string
  name: string
  type: 'slack' | 'email'
  target: string
}

export type AlertKind = 'down' | 'reminder' | 'recovered' | 'test'

export interface AlertEvent {
  kind: AlertKind
  /** null only for `test` alerts. */
  monitor: { id: string; name: string; url: string } | null
  cause: string | null
  downForMs: number | null
  dashboardUrl: string
}

export interface AttemptRecord {
  attempt: number
  ok: boolean
  error: string | null
}

export interface DeliveryResult {
  ok: boolean
  attempts: number
  error: string | null
}
