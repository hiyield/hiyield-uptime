import { createAuthClient } from 'better-auth/vue'

/** Same-origin: Better Auth defaults to /api/auth/*. */
export const authClient = createAuthClient()
