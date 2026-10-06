import * as schema from '../db/schema'

/**
 * Public (outside /api, so the auth middleware skips it). Watched by an external pinger:
 * 500 means at least one active monitor has stopped checking.
 */
export default defineEventHandler(async (event) => {
  const m = schema.monitors
  const rows = await useDb(event)
    .select({
      id: m.id,
      intervalS: m.intervalS,
      paused: m.paused,
      lastCheckedAt: m.lastCheckedAt,
      createdAt: m.createdAt
    })
    .from(m)
  const stale = findStaleMonitors(rows, Date.now())
  if (stale.length) {
    setResponseStatus(event, 500)
    return { ok: false, stale }
  }
  return { ok: true, active: rows.filter((r) => !r.paused).length }
})
