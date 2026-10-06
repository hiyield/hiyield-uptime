import { and, eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)
  // Only a paused monitor resumes: resetting a live monitor's status to 'unknown' would desync it from its DO.
  const updated = await db
    .update(schema.monitors)
    .set({ paused: false, status: 'unknown', updatedAt: Date.now() })
    .where(and(eq(schema.monitors.id, id), eq(schema.monitors.paused, true)))
    .returning({ id: schema.monitors.id })
  if (updated.length === 0) {
    const exists = await db.query.monitors.findFirst({
      where: eq(schema.monitors.id, id),
      columns: { id: true }
    })
    if (!exists) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
    throw createError({ statusCode: 409, statusMessage: 'Monitor is not paused' })
  }
  await callMonitor(event, id, 'reload')
  return { ok: true }
})
