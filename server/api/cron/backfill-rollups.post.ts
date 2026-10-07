import { backfillRollups } from '../../utils/rollups'

/** One-off: rebuild rollups from raw checks after deploying the rollup tables. Requires x-admin-secret. */
export default defineEventHandler(async (event) => {
  requireAdminSecret(event)
  return { ok: true, ...(await backfillRollups(useDb(event), Date.now())) }
})
