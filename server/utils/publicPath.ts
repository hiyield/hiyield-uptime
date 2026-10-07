/**
 * API paths that skip the session check. Cron routes check x-admin-secret instead.
 * `/api/_nuxt_icon/` serves icon SVGs, which the login page needs before anyone has a session.
 */
export function isPublicApiPath(path: string): boolean {
  return path.startsWith('/api/auth/') || path.startsWith('/api/cron/') || path.startsWith('/api/_nuxt_icon/')
}
