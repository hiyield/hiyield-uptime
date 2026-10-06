import { ALERT_MAX_ATTEMPTS } from '../../../shared/utils/constants'
import type { AlertEvent, AttemptRecord, Contact, DeliveryResult, FetchFn } from '../types'
import { deliverEmail, emailPayload } from './email'
import { deliverSlack, slackPayload } from './slack'

export type SendAlert = (
  contact: Contact,
  event: AlertEvent,
  onAttempt?: (r: AttemptRecord) => Promise<void>
) => Promise<DeliveryResult>

export interface SenderDeps {
  fetch: FetchFn
  resendApiKey: string
  mailFrom: string
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
}

/**
 * One function per channel type. Adding SMS later = one new module + one branch here.
 * Retries with 500ms/1000ms backoff; `onAttempt` sees every attempt (recorded as alert_deliveries rows).
 */
export function createSender(deps: SenderDeps): SendAlert {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const max = deps.maxAttempts ?? ALERT_MAX_ATTEMPTS
  return async (contact, event, onAttempt) => {
    let lastError: string | null = null
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        if (contact.type === 'slack') {
          await deliverSlack(deps.fetch, contact.target, slackPayload(event))
        } else {
          await deliverEmail(
            deps.fetch,
            deps.resendApiKey,
            emailPayload(event, deps.mailFrom, contact.target)
          )
        }
        await onAttempt?.({ attempt, ok: true, error: null })
        return { ok: true, attempts: attempt, error: null }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        await onAttempt?.({ attempt, ok: false, error: lastError })
        if (attempt < max) await sleep(500 * 2 ** (attempt - 1))
      }
    }
    return { ok: false, attempts: max, error: lastError }
  }
}
