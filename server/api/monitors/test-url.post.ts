import { runCheck } from '../../engine/runCheck'

export default defineEventHandler(async (event) => {
  const { url, timeoutMs } = await readValidatedBody(event, testUrlSchema.parse)
  return runCheck(url, { timeoutMs })
})
