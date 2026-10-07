/**
 * Worker entry (wrangler `main`). Nitro's cloudflare-module preset only exports
 * `{ fetch }`; DO classes must be named exports of `main` for wrangler to bind them.
 * Add new DO classes here AND to wrangler.jsonc → env.<name>.{durable_objects, migrations}.
 *
 * `nuxt dev` never sees this file — see wrangler.dev.jsonc for how DOs run locally.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - emitted by `nuxt build`, may be absent before a build
import nitroHandler from '../.output/server/index.mjs'
import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types'

export { MonitorDO } from '../server/engine/MonitorDO'
export { ProbeDO } from '../server/engine/ProbeDO'

const CRON_ROUTES: Record<string, string> = {
  '*/10 * * * *': '/api/cron/reconcile',
  '0 3 * * *': '/api/cron/prune'
}

export default {
  fetch: nitroHandler.fetch,

  /** Forward each cron into Nitro so the logic lives with the app. Never await inside scheduled(). */
  async scheduled(event: ScheduledController, env: { ADMIN_API_SECRET: string }, ctx: ExecutionContext) {
    const path = CRON_ROUTES[event.cron]
    if (!path) return
    const req = new Request(`https://internal${path}`, {
      method: 'POST',
      headers: { 'x-admin-secret': env.ADMIN_API_SECRET }
    })
    ctx.waitUntil(
      nitroHandler.fetch(req, env, ctx).then(async (res: Response) => {
        if (!res.ok) console.error(`[cron] ${path} returned ${res.status}`, await res.text().catch(() => ''))
      })
    )
  }
}
