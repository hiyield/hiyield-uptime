export interface IncidentSpan {
  monitorId: string
  startedAt: number
  resolvedAt: number | null
}

/** Half-open interval [start, end). */
export interface Period {
  start: number
  end: number
}

export function overlapMs(i: IncidentSpan, p: Period, now: number): number {
  const end = Math.min(i.resolvedAt ?? now, p.end)
  const start = Math.max(i.startedAt, p.start)
  return Math.max(0, end - start)
}

export function downtimeByPeriod(
  incidents: IncidentSpan[],
  periods: Period[],
  now: number
): { ms: number; monitorIds: string[] }[] {
  return periods.map((p) => {
    let ms = 0
    const ids: string[] = []
    for (const i of incidents) {
      const o = overlapMs(i, p, now)
      if (o <= 0) continue
      ms += o
      if (!ids.includes(i.monitorId)) ids.push(i.monitorId)
    }
    return { ms, monitorIds: ids }
  })
}

export function downtimeByMonitor(incidents: IncidentSpan[], p: Period, now: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const i of incidents) {
    const o = overlapMs(i, p, now)
    if (o > 0) out.set(i.monitorId, (out.get(i.monitorId) ?? 0) + o)
  }
  return out
}
