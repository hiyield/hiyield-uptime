import type { D1Database, DurableObjectNamespace, ExecutionContext } from '@cloudflare/workers-types'

/**
 * Bindings and secrets on `event.context.cloudflare.env`.
 * Update whenever a binding or `wrangler secret` is added.
 */
export interface CloudflareEnv {
  DB: D1Database

  /**
   * Durable Objects. Optional: they exist in deployed envs and `cf:dev`, but NOT under
   * `nuxt dev` (which runs the Nitro bundle without .cloudflare/worker.ts). See server/utils/engine.ts.
   */
  MONITOR?: DurableObjectNamespace
  PROBE?: DurableObjectNamespace

  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string

  RESEND_API_KEY: string
  MAIL_FROM: string
  PUBLIC_BASE_URL: string

  /** Shared secret for cron → Nitro calls (x-admin-secret header). */
  ADMIN_API_SECRET: string
}

export interface SessionUser {
  id: string
  email: string
  name: string
}

declare module 'h3' {
  interface H3EventContext {
    cloudflare: {
      env: CloudflareEnv
      context: ExecutionContext
      request: Request
    }
    /** Set by server/middleware/auth.ts for every authenticated /api request. */
    user?: SessionUser
  }
}

export {}
