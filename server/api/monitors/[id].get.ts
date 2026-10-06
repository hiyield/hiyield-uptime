export default defineEventHandler(async (event) => {
  const monitor = await getMonitorWithContacts(useDb(event), getRouterParam(event, 'id')!)
  if (!monitor) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
  return monitor
})
