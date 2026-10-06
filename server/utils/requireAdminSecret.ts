import { createError, getHeader, type H3Event } from 'h3'

/** Cron → Nitro calls carry ADMIN_API_SECRET. An unset secret never matches. */
export function requireAdminSecret(event: H3Event): void {
  const expected = event.context.cloudflare?.env?.ADMIN_API_SECRET
  if (!expected || getHeader(event, 'x-admin-secret') !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}
