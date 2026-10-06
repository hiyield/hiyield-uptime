export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const input = await readValidatedBody(event, monitorInputSchema.parse)
  const found = await updateMonitor(useDb(event), id, input, Date.now())
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
  await callMonitor(event, id, input.paused ? 'stop' : 'reload')
  return { ok: true }
})
