import { createError, readBody, type H3Event } from 'h3'
import type { z } from 'zod'

/**
 * Like h3's `readValidatedBody`, but surfaces the real Zod message as `message`.
 * `readValidatedBody`/`createValidationError` buries the real message in `data.message` as a JSON
 * string, so every failure showed a generic "Validation Error" toast. The full text goes in
 * `message` (h3 strips non-ASCII such as "—" or "…" from `statusMessage`, which is an HTTP
 * reason phrase); the client's `errorMessage()` reads `data.message` first.
 */
export async function validateBody<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.output<T>> {
  const body = await readBody(event)
  const result = schema.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      message: result.error.issues[0]?.message ?? 'Validation failed',
      data: { issues: result.error.issues }
    })
  }
  return result.data
}
