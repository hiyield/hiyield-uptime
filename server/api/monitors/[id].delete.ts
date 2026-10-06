import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  // Stop the DO first; if that fails we still delete — a DO with no monitor row stops itself on its next tick.
  await callMonitor(event, id, 'destroy').catch((err) =>
    console.error('[monitors.delete] destroy failed', err)
  )
  await useDb(event).delete(schema.monitors).where(eq(schema.monitors.id, id))
  return { ok: true }
})
