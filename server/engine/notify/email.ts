import type { AlertEvent, FetchFn } from '../types'
import { buildMessage } from './message'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function emailPayload(e: AlertEvent, from: string, to: string) {
  const m = buildMessage(e)
  const subject = m.title.replace(/^\S+\s/, '') // drop the leading emoji
  const color = m.tone === 'danger' ? '#e11d48' : m.tone === 'good' ? '#059669' : '#334155'
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#0f172a">
<h2 style="color:${color};margin:0 0 12px">${escapeHtml(subject)}</h2>
<p style="line-height:1.6;margin:0">${m.lines.map(escapeHtml).join('<br>')}</p>
</div>`
  const text = [subject, '', ...m.lines].join('\n')
  return { from, to: [to], subject, html, text }
}

export async function deliverEmail(fetchFn: FetchFn, apiKey: string, payload: unknown): Promise<void> {
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`)
}
