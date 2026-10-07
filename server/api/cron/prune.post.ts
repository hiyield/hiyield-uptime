import { CHECK_RETENTION_DAYS } from '../../../shared/utils/constants'
import { pruneRollups } from '../../utils/rollups'

export default defineEventHandler(async (event) => {
  requireAdminSecret(event)
  const db = useDb(event)
  const now = Date.now()
  await pruneChecks(db, now - CHECK_RETENTION_DAYS * DAY)
  await pruneRollups(db, now)
  return { ok: true }
})
