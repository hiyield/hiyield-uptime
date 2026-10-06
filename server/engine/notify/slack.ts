import type { AlertEvent, FetchFn } from '../types'
import { buildMessage } from './message'

const COLORS = { danger: '#e11d48', good: '#059669', neutral: '#64748b' } as const

export function slackPayload(e: AlertEvent) {
  const m = buildMessage(e)
  return {
    text: m.title,
    attachments: [
      {
        color: COLORS[m.tone],
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${m.title}*\n${m.lines.join('\n')}` } }]
      }
    ]
  }
}

export async function deliverSlack(fetchFn: FetchFn, webhookUrl: string, payload: unknown): Promise<void> {
  const res = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`Slack responded ${res.status}: ${(await res.text()).slice(0, 200)}`)
}
