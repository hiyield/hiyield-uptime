import * as schema from '../../db/schema'

/**
 * Safety net every 10 minutes: any active monitor that has gone quiet gets its DO
 * reloaded (reload schedules an immediate check when no alarm exists).
 */
export default defineEventHandler(async (event) => {
  requireAdminSecret(event)
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
  for (const id of stale) {
    await callMonitor(event, id, 'reload').catch((err) => console.error(`[reconcile] ${id}`, err))
  }
  return { reloaded: stale }
})
