export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { note } = await validateBody(event, incidentNoteSchema)
  const found = await setIncidentNote(useDb(event), id, note, event.context.user!.email, Date.now())
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Incident not found' })
  return { ok: true }
})
