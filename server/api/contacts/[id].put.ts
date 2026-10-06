export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, contactUpdateSchema.parse)
  const result = await updateContact(useDb(event), getRouterParam(event, 'id')!, input)
  if (!result.ok) throw createError({ statusCode: result.status, statusMessage: result.message })
  return { ok: true }
})
