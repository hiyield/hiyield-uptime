/** API paths that skip the session check. Cron routes check x-admin-secret instead. */
export function isPublicApiPath(path: string): boolean {
  return path.startsWith('/api/auth/') || path.startsWith('/api/cron/')
}
