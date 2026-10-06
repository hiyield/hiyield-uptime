import type { DurableObjectState } from '@cloudflare/workers-types'
import { runCheck } from './runCheck'

/**
 * Second-opinion checker. One instance named `probe-enam`, created with
 * `locationHint: 'enam'` so it runs in eastern North America — a different
 * network path from the UK-placed MonitorDOs. Stateless.
 */
export class ProbeDO {
  constructor(
    private ctx: DurableObjectState,
    private env: unknown
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/probe')
      return new Response('Not found', { status: 404 })
    const body = (await request.json()) as { url: string; timeoutMs: number }
    return Response.json(await runCheck(body.url, { timeoutMs: body.timeoutMs }))
  }
}
