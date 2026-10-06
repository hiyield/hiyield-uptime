import { describe, expect, it } from 'vitest'
import { rangeError } from '../../app/utils/dates'

describe('rangeError', () => {
  it('requires both start and end', () => {
    expect(rangeError('', '2026-10-06T10:00')).toBe('Start and end are required')
    expect(rangeError('2026-10-06T09:00', '')).toBe('Start and end are required')
  })
  it('requires end after start', () => {
    expect(rangeError('2026-10-06T10:00', '2026-10-06T10:00')).toBe('End must be after start')
    expect(rangeError('2026-10-06T10:00', '2026-10-06T09:00')).toBe('End must be after start')
  })
  it('accepts a valid range', () => {
    expect(rangeError('2026-10-06T09:00', '2026-10-06T10:00')).toBeNull()
  })
})
