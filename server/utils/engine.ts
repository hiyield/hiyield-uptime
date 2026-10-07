import { createError, type H3Event } from 'h3'

export type EngineOp = 'reload' | 'stop' | 'check-now' | 'destroy'

/** Sidecar started by `npm run dev` (wrangler.dev.jsonc). */
const DEV_ENGINE_URL = 'http://localhost:8787'

/**
 * Tell a site's MonitorDO about a change. Deployed (and cf:dev): via the MONITOR binding.
 * `nuxt dev`: the binding doesn't exist, so forward to the engine sidecar over HTTP.
 */
export async function callMonitor(event: H3Event, monitorId: string, op: EngineOp): Promise<void> {
  const env = event.context.cloudflare?.env
  const body = JSON.stringify({ monitorId })
  let res: Response
  if (env?.MONITOR) {
    const stub = env.MONITOR.get(env.MONITOR.idFromName(monitorId))
    res = (await stub.fetch(`https://monitor/${op}`, { method: 'POST', body })) as unknown as Response
  } else if (import.meta.dev) {
    res = await fetch(`${DEV_ENGINE_URL}/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-do-ns': 'monitor', 'x-do-id': monitorId },
      body
    })
  } else {
    throw createError({ statusCode: 500, statusMessage: 'MONITOR binding missing' })
  }
  if (!res.ok) {
    throw createError({ statusCode: 502, statusMessage: `Monitor engine ${op} failed (${res.status})` })
  }
}
