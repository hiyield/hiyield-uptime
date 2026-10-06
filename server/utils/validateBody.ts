import { createError, readBody, type H3Event } from 'h3'
import type { z } from 'zod'

/**
 * Like h3's `readValidatedBody`, but surfaces the real Zod message as `statusMessage`.
 * `readValidatedBody`/`createValidationError` always hardcodes `statusMessage: "Validation Error"`
 * and buries the real message in `data.message` as a JSON string; the client's `errorMessage()`
 * reads `data.statusMessage` first, so without this every validation failure showed a useless
 * generic "Validation Error" toast instead of e.g. "End must be after start".
 */
export async function validateBody<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.output<T>> {
  const body = await readBody(event)
  const result = schema.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: result.error.issues[0]?.message ?? 'Validation Error',
      data: { issues: result.error.issues }
    })
  }
  return result.data
}
