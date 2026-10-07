import { getInsights, insightsQuerySchema } from '../utils/insights'

export default defineEventHandler(async (event) => {
  const parsed = insightsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid range'
    throw createError({ statusCode: 400, statusMessage: 'Validation failed', message })
  }
  return getInsights(useDb(event), parsed.data.range, Date.now())
})
