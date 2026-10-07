import { defineEventHandler, getRequestURL } from 'h3'
import { isPublicApiPath } from '../utils/publicPath'
import { requireUser } from '../utils/requireUser'

/** Every /api route is authenticated unless listed in isPublicApiPath — no per-route opt-in to forget. */
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/') || isPublicApiPath(path)) return
  event.context.user = await requireUser(event)
})
