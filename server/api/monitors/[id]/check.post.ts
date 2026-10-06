export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const monitor = await getMonitorWithContacts(useDb(event), id)
  if (!monitor) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
  if (monitor.paused) throw createError({ statusCode: 409, statusMessage: 'Monitor is paused' })
  await callMonitor(event, id, 'check-now')
  return { ok: true }
})
