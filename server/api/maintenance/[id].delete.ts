import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  await useDb(event)
    .delete(schema.maintenanceWindows)
    .where(eq(schema.maintenanceWindows.id, getRouterParam(event, 'id')!))
  return { ok: true }
})
