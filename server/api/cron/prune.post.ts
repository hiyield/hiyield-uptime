import { CHECK_RETENTION_DAYS } from '../../../shared/utils/constants'

export default defineEventHandler(async (event) => {
  requireAdminSecret(event)
  await pruneChecks(useDb(event), Date.now() - CHECK_RETENTION_DAYS * DAY)
  return { ok: true }
})
