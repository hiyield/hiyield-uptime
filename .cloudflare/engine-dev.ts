/**
 * Dev + integration-test worker entry. Hosts the real Durable Objects WITHOUT the
 * Nitro bundle, so it runs with no `nuxt build` (same pattern as qa's .cloudflare/do-dev.ts).
 *
 * Under `nuxt dev` the MONITOR binding doesn't exist; server/utils/engine.ts forwards
 * DO calls here over HTTP: `POST http://localhost:8787/<op>` with headers
 * `x-do-ns: monitor` and `x-do-id: <monitorId>`.
 *
 * Keep imports plain-relative — a Nuxt alias here would force a build.
 */
import type { DurableObjectNamespace } from '@cloudflare/workers-types'

export { MonitorDO } from '../server/engine/MonitorDO'
export { ProbeDO } from '../server/engine/ProbeDO'

interface DevEnv {
  MONITOR: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: DevEnv): Promise<Response> {
    const ns = request.headers.get('x-do-ns')
    const id = request.headers.get('x-do-id')
    if (ns !== 'monitor' || !id) {
      return new Response('engine dev worker: expected x-do-ns: monitor and x-do-id headers', { status: 400 })
    }
    const stub = env.MONITOR.get(env.MONITOR.idFromName(id))
    const { pathname } = new URL(request.url)
    return stub.fetch(`https://monitor${pathname}`, {
      method: request.method,
      headers: { 'content-type': 'application/json' },
      body: request.method === 'POST' ? await request.text() : undefined
    }) as unknown as Response
  }
}
