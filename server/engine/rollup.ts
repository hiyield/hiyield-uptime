import { DAY_MS, ROLLUP_30M_MS } from '../../shared/utils/constants'
import type { CheckResult } from './types'

export interface RollupDelta {
  checks: number
  failures: number
  blips: number
  maintenance: number
  respSum: number
  respCount: number
  respMax: number
}

export const bucket30m = (ms: number): number => Math.floor(ms / ROLLUP_30M_MS) * ROLLUP_30M_MS
export const dayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS

/** One primary check's contribution to a rollup row. Pure. */
export function rollupDelta(
  check: CheckResult,
  opts: { confirmed: boolean; maintenance: boolean }
): RollupDelta {
  const failed = !check.ok && !opts.maintenance
  const ms = check.responseMs
  return {
    checks: 1,
    failures: failed && opts.confirmed ? 1 : 0,
    blips: failed && !opts.confirmed ? 1 : 0,
    maintenance: opts.maintenance ? 1 : 0,
    respSum: ms ?? 0,
    respCount: ms === null ? 0 : 1,
    respMax: ms ?? 0
  }
}
