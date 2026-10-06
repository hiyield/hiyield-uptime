import { z } from 'zod'
import {
  FAIL_THRESHOLD_MAX,
  FAIL_THRESHOLD_MIN,
  INTERVALS_S,
  REMINDER_MINS,
  TIMEOUT_MS_MAX,
  TIMEOUT_MS_MIN
} from './constants'

export const URL_ERROR = 'Enter a full http:// or https:// URL'

export function normaliseUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

const urlField = z.string().transform((v, ctx) => {
  const n = normaliseUrl(v)
  if (!n) {
    ctx.addIssue({ code: 'custom', message: URL_ERROR })
    return z.NEVER
  }
  return n
})

export const monitorInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  url: urlField,
  intervalS: z
    .number()
    .int()
    .refine((v) => INTERVALS_S.includes(v), 'Choose an interval from the list'),
  timeoutMs: z.number().int().min(TIMEOUT_MS_MIN).max(TIMEOUT_MS_MAX),
  failThreshold: z.number().int().min(FAIL_THRESHOLD_MIN).max(FAIL_THRESHOLD_MAX),
  reminderMins: z
    .number()
    .int()
    .refine((v) => REMINDER_MINS.includes(v), 'Choose a reminder from the list'),
  paused: z.boolean(),
  contactIds: z.array(z.string()).max(50).default([])
})
export type MonitorInput = z.output<typeof monitorInputSchema>

export const testUrlSchema = z.object({
  url: urlField,
  timeoutMs: z.number().int().min(TIMEOUT_MS_MIN).max(TIMEOUT_MS_MAX).default(10_000)
})
