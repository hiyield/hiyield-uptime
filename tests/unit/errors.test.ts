import { describe, expect, it } from 'vitest'
import { errorMessage } from '../../app/utils/errors'

describe('errorMessage', () => {
  it('prefers data.message (full text) over the ASCII-stripped data.statusMessage', () => {
    const e = { data: { statusMessage: 'Validation failed', message: 'End must be after start — try again' } }
    expect(errorMessage(e)).toBe('End must be after start — try again')
  })
  it('falls back to data.statusMessage, then the error message, then a default', () => {
    expect(errorMessage({ data: { statusMessage: 'Monitor not found' } })).toBe('Monitor not found')
    expect(errorMessage({ message: 'Network down' })).toBe('Network down')
    expect(errorMessage(undefined)).toBe('Something went wrong')
  })
})
