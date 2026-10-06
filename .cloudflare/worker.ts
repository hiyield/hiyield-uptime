/**
 * Worker entry (wrangler `main`). Nitro's cloudflare-module preset only exports
 * `{ fetch }`; this wrapper is where Durable Object classes are re-exported
 * (Task 8) and cron triggers are routed (Task 12).
 *
 * `nuxt dev` never sees this file — see wrangler.dev.jsonc for how DOs run locally.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - emitted by `nuxt build`, may be absent before a build
import nitroHandler from '../.output/server/index.mjs'

export default {
  fetch: nitroHandler.fetch
}
