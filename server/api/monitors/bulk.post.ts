import { z } from 'zod'
import * as schema from '../../db/schema'

const bulkSchema = z.object({
  text: z.string().max(50_000),
  tags: monitorInputSchema.shape.tags
})

export default defineEventHandler(async (event) => {
  const { text, tags } = await validateBody(event, bulkSchema)
  const db = useDb(event)
  const existing = await db.select({ url: schema.monitors.url }).from(schema.monitors)
  const rows = parseBulk(
    text,
    existing.map((m) => m.url)
  )
  if (rows.length === 0 || rows.some((r) => r.error)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Fix the highlighted lines',
      message: 'Fix the highlighted lines',
      data: { rows }
    })
  }
  const contactIds = await defaultContactIds(db)
  const now = Date.now()
  for (const row of rows) {
    const id = crypto.randomUUID()
    await createMonitor(
      db,
      monitorInputSchema.parse({ ...MONITOR_DEFAULTS, name: row.name, url: row.url, contactIds, tags }),
      now,
      id
    )
    // The row is saved; if the engine call fails the reconcile cron starts it within 10 min.
    // Failing here would make the user retry and create duplicates.
    await callMonitor(event, id, 'reload').catch((err) =>
      console.error('[monitors.bulk] reload failed', id, err)
    )
  }
  return { created: rows.length }
})
