import { createError, type H3Event } from 'h3'
import { isAllowedEmail } from '../../shared/utils/email'
import type { SessionUser } from '../types/cloudflare'
import { serverAuth } from './auth'

export async function requireUser(event: H3Event): Promise<SessionUser> {
  const session = await serverAuth(event).api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Unauthenticated' })
  if (!isAllowedEmail(session.user.email)) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  return { id: session.user.id, email: session.user.email, name: session.user.name }
}
