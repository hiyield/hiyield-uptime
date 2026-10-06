export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, monitorInputSchema.parse)
  const db = useDb(event)
  const id = crypto.randomUUID()
  await createMonitor(db, input, Date.now(), id)
  if (!input.paused) await callMonitor(event, id, 'reload')
  return { id }
})
