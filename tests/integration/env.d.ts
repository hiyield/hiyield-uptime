/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      MONITOR: DurableObjectNamespace
      PROBE: DurableObjectNamespace
      TEST_MIGRATIONS: D1Migration[]
      RESEND_API_KEY: string
      MAIL_FROM: string
      PUBLIC_BASE_URL: string
    }
  }
}

export {}
