export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

/** `<input type="datetime-local">` value ↔ epoch ms, in the browser's local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): number {
  return new Date(value).getTime()
}

/**
 * Client-side check for a datetime-local start/end pair, before posting. An empty input gives
 * NaN, which the server would only reject with a cryptic "expected number".
 */
export function rangeError(startsAt: string, endsAt: string): string | null {
  const start = fromLocalInput(startsAt)
  const end = fromLocalInput(endsAt)
  if (!startsAt || !endsAt || Number.isNaN(start) || Number.isNaN(end)) return 'Start and end are required'
  if (end <= start) return 'End must be after start'
  return null
}
