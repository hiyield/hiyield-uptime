import { eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const updated = await useDb(event)
    .update(schema.monitors)
    .set({ paused: true, status: 'paused', consecutiveFailures: 0, updatedAt: Date.now() })
    .where(eq(schema.monitors.id, id))
    .returning({ id: schema.monitors.id })
  // Unknown id: don't touch the DO (calling it would create empty storage for a monitor that doesn't exist).
  if (updated.length === 0) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
  await callMonitor(event, id, 'stop')
  return { ok: true }
})
