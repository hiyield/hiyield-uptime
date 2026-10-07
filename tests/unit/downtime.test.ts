import { describe, expect, it } from 'vitest'
import { downtimeByMonitor, downtimeByPeriod, overlapMs } from '../../server/utils/downtime'

const D = 86_400_000
const day0 = Date.UTC(2026, 9, 1)
const p = (i: number) => ({ start: day0 + i * D, end: day0 + (i + 1) * D })
const NOW = day0 + 3 * D + 6 * 3_600_000 // day 3, 06:00

describe('overlapMs', () => {
  it('inside one period', () => {
    expect(overlapMs({ monitorId: 'a', startedAt: day0 + 1000, resolvedAt: day0 + 61_000 }, p(0), NOW)).toBe(
      60_000
    )
  })
  it('clips at both edges', () => {
    const i = { monitorId: 'a', startedAt: day0 - 5000, resolvedAt: day0 + D + 5000 }
    expect(overlapMs(i, p(0), NOW)).toBe(D)
    expect(overlapMs(i, p(1), NOW)).toBe(5000)
  })
  it('open incident runs to now', () => {
    expect(overlapMs({ monitorId: 'a', startedAt: day0 + 3 * D, resolvedAt: null }, p(3), NOW)).toBe(
      6 * 3_600_000
    )
  })
  it('no overlap is zero, never negative', () => {
    expect(
      overlapMs({ monitorId: 'a', startedAt: day0 + 2 * D, resolvedAt: day0 + 2 * D + 10 }, p(0), NOW)
    ).toBe(0)
  })
})

describe('downtimeByPeriod', () => {
  it('spans midnight and lists affected monitors per period', () => {
    const res = downtimeByPeriod(
      [
        { monitorId: 'a', startedAt: day0 + D - 60_000, resolvedAt: day0 + D + 120_000 },
        { monitorId: 'b', startedAt: day0 + D + 1000, resolvedAt: day0 + D + 2000 }
      ],
      [p(0), p(1), p(2)],
      NOW
    )
    expect(res).toEqual([
      { ms: 60_000, monitorIds: ['a'] },
      { ms: 121_000, monitorIds: ['a', 'b'] },
      { ms: 0, monitorIds: [] }
    ])
  })
})

describe('downtimeByMonitor', () => {
  it('sums per monitor within the period', () => {
    const m = downtimeByMonitor(
      [
        { monitorId: 'a', startedAt: day0, resolvedAt: day0 + 1000 },
        { monitorId: 'a', startedAt: day0 + 5000, resolvedAt: day0 + 7000 },
        { monitorId: 'b', startedAt: day0 - D, resolvedAt: day0 - D + 10 }
      ],
      { start: day0, end: day0 + D },
      NOW
    )
    expect(Object.fromEntries(m)).toEqual({ a: 3000 })
  })
})
