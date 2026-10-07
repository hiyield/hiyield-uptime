import { APIError } from 'better-auth/api'
import { isAllowedEmail } from '../../shared/utils/email'

/** Runs in Better Auth's user.create.before hook — blocks the account before it exists. */
export function assertAllowedSignup(email: string): void {
  if (!isAllowedEmail(email)) {
    throw new APIError('FORBIDDEN', { message: 'Only @hiyield.co.uk Google accounts can sign in.' })
  }
}
