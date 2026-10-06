export default defineEventHandler(async (event) => {
  const input = await validateBody(event, monitorInputSchema)
  const db = useDb(event)
  const id = crypto.randomUUID()
  await createMonitor(db, input, Date.now(), id)
  if (!input.paused) await callMonitor(event, id, 'reload')
  return { id }
})
