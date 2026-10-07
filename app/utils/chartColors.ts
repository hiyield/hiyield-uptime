import type { BarState } from '~~/server/utils/boardCharts'

/** Status colours on the dark #001313 surface — validated with the dataviz validator (see plan Global Constraints). */
export const STATE_COLOR: Record<BarState, string> = {
  up: '#00faa0',
  blip: '#fbbf24',
  down: '#ef4444',
  maintenance: '#0ea5e9',
  none: '#1f2b2b'
}
/** Height is the second encoding so state is never colour-only. */
export const STATE_HEIGHT: Record<BarState, number> = {
  down: 100,
  blip: 75,
  up: 50,
  maintenance: 50,
  none: 25
}
export const STATE_LABEL: Record<BarState, string> = {
  up: 'Up',
  blip: 'Blip (not confirmed)',
  down: 'Down',
  maintenance: 'Maintenance',
  none: 'No data'
}
export const SERIES = '#00faa0'
export const NEUTRAL_BAR = '#4b5959'
export const GRID = '#163636'
export const AXIS_TEXT = 'rgba(255, 255, 255, 0.6)'

export function formatBucketTime(ms: number, spanMs: number): string {
  return new Date(ms).toLocaleString(
    'en-GB',
    spanMs >= 86_400_000
      ? { day: 'numeric', month: 'short' }
      : { hour: '2-digit', minute: '2-digit', hour12: false }
  )
}
