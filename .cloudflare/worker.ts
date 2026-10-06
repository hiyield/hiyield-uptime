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

export { MonitorDO } from '../server/engine/MonitorDO'
export { ProbeDO } from '../server/engine/ProbeDO'

export default {
  fetch: nitroHandler.fetch
}
