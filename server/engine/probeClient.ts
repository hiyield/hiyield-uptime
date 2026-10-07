import type { DurableObjectNamespace } from '@cloudflare/workers-types'
import { PROBE_LOCATION_HINT, PROBE_NAME } from '../../shared/utils/constants'
import type { CheckResult } from './types'

/** Throws if the probe itself is unreachable — MonitorDO treats that as a confirmed failure. */
export async function probeCheck(
  ns: DurableObjectNamespace,
  url: string,
  timeoutMs: number
): Promise<CheckResult> {
  const stub = ns.get(ns.idFromName(PROBE_NAME), { locationHint: PROBE_LOCATION_HINT })
  const res = await stub.fetch('https://probe/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, timeoutMs })
  })
  if (!res.ok) throw new Error(`Probe responded ${res.status}`)
  return (await res.json()) as CheckResult
}
