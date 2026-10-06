/** Values fixed by the design spec. Shared by the engine, the API and the dashboard. */
export const INTERVALS_S: readonly number[] = [30, 60, 120, 300, 600, 900, 1800]
export const REMINDER_MINS: readonly number[] = [0, 15, 30, 60]
export const TIMEOUT_MS_MIN = 1_000
export const TIMEOUT_MS_MAX = 30_000
export const FAIL_THRESHOLD_MIN = 1
export const FAIL_THRESHOLD_MAX = 10

/** A SUSPECT monitor re-checks this soon, whatever its interval. */
export const SUSPECT_RETRY_MS = 30_000
export const CHECK_RETENTION_DAYS = 90
export const ALERT_MAX_ATTEMPTS = 3

export const PROBE_NAME = 'probe-enam'
export const PROBE_LOCATION_HINT = 'enam'

export const MONITOR_DEFAULTS = {
  intervalS: 300,
  timeoutMs: 10_000,
  failThreshold: 2,
  reminderMins: 30,
  paused: false
} as const

/** "Launch watch" preset for newly launched sites. */
export const LAUNCH_WATCH = { intervalS: 60, failThreshold: 1 } as const

export const ALLOWED_EMAIL_DOMAIN = 'hiyield.co.uk'
