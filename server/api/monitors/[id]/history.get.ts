export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)
  const monitor = await getMonitorWithContacts(db, id)
  if (!monitor) throw createError({ statusCode: 404, statusMessage: 'Monitor not found' })
  return { monitor, ...(await getHistory(db, id, Date.now())) }
})
