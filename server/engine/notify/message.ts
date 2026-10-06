import { formatDuration } from '../../../shared/utils/format'
import type { AlertEvent } from '../types'

export interface AlertMessage {
  title: string
  lines: string[]
  tone: 'danger' | 'good' | 'neutral'
}

/** Channel-neutral alert content. Slack and email both render from this. */
export function buildMessage(e: AlertEvent): AlertMessage {
  const lines: string[] = e.monitor ? [`URL: ${e.monitor.url}`] : []
  const name = e.monitor?.name ?? ''
  switch (e.kind) {
    case 'down':
      if (e.cause) lines.push(`Error: ${e.cause}`)
      if (e.downForMs !== null) lines.push(`Failing for: ${formatDuration(e.downForMs)}`)
      lines.push(`Dashboard: ${e.dashboardUrl}`)
      return { title: `🔴 ${name} is DOWN`, lines, tone: 'danger' }
    case 'reminder':
      if (e.cause) lines.push(`Error: ${e.cause}`)
      if (e.downForMs !== null) lines.push(`Down for: ${formatDuration(e.downForMs)}`)
      lines.push(`Dashboard: ${e.dashboardUrl}`)
      return { title: `🔴 ${name} is still DOWN`, lines, tone: 'danger' }
    case 'recovered':
      lines.push(`Was down for: ${formatDuration(e.downForMs ?? 0)}`)
      lines.push(`Dashboard: ${e.dashboardUrl}`)
      return { title: `🟢 ${name} has RECOVERED`, lines, tone: 'good' }
    case 'test':
      return {
        title: '🧪 Test alert from Hiyield Uptime',
        lines: [
          'This is a test alert from Hiyield Uptime. If you can read this, alerts to this contact work.',
          `Dashboard: ${e.dashboardUrl}`
        ],
        tone: 'neutral'
      }
  }
}
