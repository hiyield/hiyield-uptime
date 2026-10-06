import { eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await useDb(event)
    .update(schema.monitors)
    .set({ paused: false, status: 'unknown', updatedAt: Date.now() })
    .where(eq(schema.monitors.id, id))
  await callMonitor(event, id, 'reload')
  return { ok: true }
})
