import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { createError, type H3Event } from 'h3'
import * as schema from '../db/schema'

export type Db = DrizzleD1Database<typeof schema>

/** Bindings are request-scoped on Workers — build the client per request. */
export const useDb = (event: H3Event): Db => {
  const env = event.context.cloudflare?.env
  if (!env?.DB) {
    throw createError({ statusCode: 500, statusMessage: 'D1 binding DB not found' })
  }
  return drizzle(env.DB, { schema })
}
