export default defineEventHandler(async (event) => {
  const input = await validateBody(event, contactUpdateSchema)
  const result = await updateContact(useDb(event), getRouterParam(event, 'id')!, input)
  if (!result.ok) {
    // `message` keeps the full (possibly non-ASCII) Zod text; statusMessage is an HTTP reason phrase.
    throw createError({
      statusCode: result.status,
      statusMessage: result.status === 404 ? 'Not found' : 'Validation failed',
      message: result.message
    })
  }
  return { ok: true }
})
