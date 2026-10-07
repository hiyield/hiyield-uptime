import { describe, expect, it } from 'vitest'
import { isAllowedEmail } from '../../shared/utils/email'
import { formatDuration, formatInterval } from '../../shared/utils/format'
import { displayStatus, STATUS_SORT } from '../../shared/utils/status'
import { INTERVALS_S, MONITOR_DEFAULTS, LAUNCH_WATCH } from '../../shared/utils/constants'

describe('isAllowedEmail', () => {
  it('accepts hiyield.co.uk addresses regardless of case and whitespace', () => {
    expect(isAllowedEmail('logan@hiyield.co.uk')).toBe(true)
    expect(isAllowedEmail('  Logan@HiYield.co.uk ')).toBe(true)
  })
  it('rejects other domains and lookalikes', () => {
    expect(isAllowedEmail('someone@gmail.com')).toBe(false)
    expect(isAllowedEmail('x@evilhiyield.co.uk')).toBe(false)
    expect(isAllowedEmail('x@hiyield.co.uk.evil.com')).toBe(false)
    expect(isAllowedEmail('')).toBe(false)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [59_000, '59s'],
    [60_000, '1m'],
    [14 * 60_000, '14m'],
    [3_600_000, '1h 0m'],
    [3_660_000, '1h 1m'],
    [25 * 3_600_000, '1d 1h'],
    [-5_000, '0s']
  ])('%i ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})

describe('formatInterval', () => {
  it('shows seconds under a minute and minutes above', () => {
    expect(formatInterval(30)).toBe('30s')
    expect(formatInterval(60)).toBe('1m')
    expect(formatInterval(1800)).toBe('30m')
  })
})

describe('displayStatus', () => {
  it('maps stored status to label and colour', () => {
    expect(displayStatus('up', false)).toEqual({ label: 'Up', color: 'success' })
    expect(displayStatus('down', false)).toEqual({ label: 'Down', color: 'error' })
    expect(displayStatus('suspect', false)).toEqual({ label: 'Suspect', color: 'warning' })
    expect(displayStatus('unknown', false)).toEqual({ label: 'Pending', color: 'neutral' })
    expect(displayStatus('paused', false)).toEqual({ label: 'Paused', color: 'neutral' })
  })
  it('shows Maintenance for active windows but Paused wins', () => {
    expect(displayStatus('down', true)).toEqual({ label: 'Maintenance', color: 'info' })
    expect(displayStatus('paused', true)).toEqual({ label: 'Paused', color: 'neutral' })
  })
  it('sorts down first and paused last', () => {
    expect(STATUS_SORT.down).toBeLessThan(STATUS_SORT.suspect)
    expect(STATUS_SORT.suspect).toBeLessThan(STATUS_SORT.up)
    expect(STATUS_SORT.up).toBeLessThan(STATUS_SORT.paused)
  })
})

describe('constants', () => {
  it('match the spec', () => {
    expect([...INTERVALS_S]).toEqual([30, 60, 120, 300, 600, 900, 1800])
    expect(MONITOR_DEFAULTS).toEqual({
      intervalS: 300,
      timeoutMs: 10_000,
      failThreshold: 2,
      reminderMins: 30,
      paused: false
    })
    expect(LAUNCH_WATCH).toEqual({ intervalS: 60, failThreshold: 1 })
  })
})
