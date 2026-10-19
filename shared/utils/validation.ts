import { z } from 'zod'
import {
  FAIL_THRESHOLD_MAX,
  FAIL_THRESHOLD_MIN,
  INCIDENT_NOTE_MAX,
  INTERVALS_S,
  REMINDER_MINS,
  TAG_MAX_LENGTH,
  TAGS_PER_MONITOR_MAX,
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

export const TAG_ERROR = `Tags are letters, numbers and hyphens, up to ${TAG_MAX_LENGTH} characters`

/** Lowercase, trimmed, inner whitespace → "-". Null if the result isn't `[a-z0-9][a-z0-9-]*` within length. */
export function normaliseTag(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '-')
  if (!t || t.length > TAG_MAX_LENGTH) return null
  return /^[a-z0-9][a-z0-9-]*$/.test(t) ? t : null
}

const tagsField = z
  .array(z.string())
  .max(TAGS_PER_MONITOR_MAX, `Up to ${TAGS_PER_MONITOR_MAX} tags per monitor`)
  .default([])
  .transform((list, ctx) => {
    const out: string[] = []
    for (const raw of list) {
      const t = normaliseTag(raw)
      if (!t) {
        ctx.addIssue({ code: 'custom', message: TAG_ERROR })
        return z.NEVER
      }
      if (!out.includes(t)) out.push(t)
    }
    return out
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
  contactIds: z.array(z.string()).max(50).default([]),
  tags: tagsField
})
export type MonitorInput = z.output<typeof monitorInputSchema>

export const testUrlSchema = z.object({
  url: urlField,
  timeoutMs: z.number().int().min(TIMEOUT_MS_MIN).max(TIMEOUT_MS_MAX).default(10_000)
})

const contactName = z.string().trim().min(1, 'Name is required').max(80)
export const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/'
const slackTarget = z
  .string()
  .trim()
  .startsWith(SLACK_WEBHOOK_PREFIX, 'Must be a Slack incoming webhook URL (https://hooks.slack.com/…)')
const emailTarget = z.string().trim().pipe(z.email('Enter a valid email address'))

export const contactCreateSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('slack'),
    name: contactName,
    target: slackTarget,
    isDefault: z.boolean().default(false)
  }),
  z.object({
    type: z.literal('email'),
    name: contactName,
    target: emailTarget,
    isDefault: z.boolean().default(false)
  })
])
export type ContactInput = z.output<typeof contactCreateSchema>

/** Blank/missing target on update = keep the stored one (the UI never receives the full webhook URL). */
export const contactUpdateSchema = z.object({
  name: contactName,
  isDefault: z.boolean(),
  target: z.string().trim().optional()
})
export type ContactUpdate = z.output<typeof contactUpdateSchema>

export const maintenanceSchema = z
  .object({
    monitorId: z.string().min(1).nullable(),
    startsAt: z.number().int().positive(),
    endsAt: z.number().int().positive(),
    note: z.string().trim().max(500).default('')
  })
  .refine((v) => v.endsAt > v.startsAt, { message: 'End must be after start', path: ['endsAt'] })
export type MaintenanceInput = z.output<typeof maintenanceSchema>

export const incidentNoteSchema = z.object({
  note: z.string().trim().max(INCIDENT_NOTE_MAX, `Keep notes under ${INCIDENT_NOTE_MAX} characters`)
})
export type IncidentNoteInput = z.output<typeof incidentNoteSchema>
