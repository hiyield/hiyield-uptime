export default defineEventHandler(async (event) => {
  const input = await validateBody(event, monitorInputSchema)
  const db = useDb(event)
  const id = crypto.randomUUID()
  await createMonitor(db, input, Date.now(), id)
  // The row is saved; if the engine call fails the reconcile cron starts it within 10 min.
  // Failing here would make the user retry and create a duplicate.
  if (!input.paused) {
    await callMonitor(event, id, 'reload').catch((err) =>
      console.error('[monitors.create] reload failed', id, err)
    )
  }
  return { id }
})
