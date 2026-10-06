import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { text } = await readValidatedBody(event, z.object({ text: z.string().max(50_000) }).parse)
  const rows = parseBulk(text)
  if (rows.length === 0 || rows.some((r) => r.error)) {
    throw createError({ statusCode: 400, statusMessage: 'Fix the highlighted lines', data: { rows } })
  }
  const db = useDb(event)
  const contactIds = await defaultContactIds(db)
  const now = Date.now()
  for (const row of rows) {
    const id = crypto.randomUUID()
    await createMonitor(
      db,
      monitorInputSchema.parse({ ...MONITOR_DEFAULTS, name: row.name, url: row.url, contactIds }),
      now,
      id
    )
    await callMonitor(event, id, 'reload')
  }
  return { created: rows.length }
})
