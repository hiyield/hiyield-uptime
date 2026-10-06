import { runCheck } from '../../engine/runCheck'

export default defineEventHandler(async (event) => {
  const { url, timeoutMs } = await validateBody(event, testUrlSchema)
  return runCheck(url, { timeoutMs })
})
