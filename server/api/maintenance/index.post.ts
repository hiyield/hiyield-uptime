import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  const input = await validateBody(event, maintenanceSchema)
  const db = useDb(event)
  if (input.monitorId) {
    const monitor = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, input.monitorId) })
    if (!monitor) throw createError({ statusCode: 400, statusMessage: 'Monitor not found' })
  }
  const id = crypto.randomUUID()
  await db.insert(schema.maintenanceWindows).values({
    id,
    ...input,
    createdBy: event.context.user!.email,
    createdAt: Date.now()
  })
  return { id }
})
