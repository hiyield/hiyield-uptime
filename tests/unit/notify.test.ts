import { describe, expect, it } from 'vitest'
import { buildMessage } from '../../server/engine/notify/message'
import { slackPayload } from '../../server/engine/notify/slack'
import { emailPayload } from '../../server/engine/notify/email'
import { createSender } from '../../server/engine/notify'
import type { AlertEvent, AttemptRecord, Contact, FetchFn } from '../../server/engine/types'

const monitor = { id: 'mon_1', name: 'Acme', url: 'https://acme.example/' }
const dashboardUrl = 'https://uptime.test/monitors/mon_1'

const ev = (o: Partial<AlertEvent>): AlertEvent => ({
  kind: 'down',
  monitor,
  cause: 'HTTP 503',
  downForMs: 60_000,
  dashboardUrl,
  ...o
})

const slack: Contact = { id: 'c1', name: '#dev', type: 'slack', target: 'https://hooks.slack.com/services/x' }
const email: Contact = { id: 'c2', name: 'Logan', type: 'email', target: 'logan@hiyield.co.uk' }

describe('buildMessage', () => {
  it('down', () => {
    expect(buildMessage(ev({}))).toEqual({
      title: '🔴 Acme is DOWN',
      lines: [
        'URL: https://acme.example/',
        'Error: HTTP 503',
        'Failing for: 1m',
        `Dashboard: ${dashboardUrl}`
      ],
      tone: 'danger'
    })
  })
  it('reminder', () => {
    const m = buildMessage(ev({ kind: 'reminder', downForMs: 45 * 60_000 }))
    expect(m.title).toBe('🔴 Acme is still DOWN')
    expect(m.lines).toContain('Down for: 45m')
  })
  it('recovered', () => {
    const m = buildMessage(ev({ kind: 'recovered', cause: null, downForMs: 14 * 60_000 }))
    expect(m).toEqual({
      title: '🟢 Acme has RECOVERED',
      lines: ['URL: https://acme.example/', 'Was down for: 14m', `Dashboard: ${dashboardUrl}`],
      tone: 'good'
    })
  })
  it('test', () => {
    const m = buildMessage(ev({ kind: 'test', monitor: null, cause: null, downForMs: null }))
    expect(m.title).toBe('🧪 Test alert from Hiyield Uptime')
    expect(m.tone).toBe('neutral')
    expect(m.lines[0]).toMatch(/alerts to this contact work/)
  })
})

describe('slackPayload', () => {
  it('uses red for down and green for recovered', () => {
    const down = slackPayload(ev({})) as { text: string; attachments: { color: string }[] }
    expect(down.text).toBe('🔴 Acme is DOWN')
    expect(down.attachments[0]!.color).toBe('#e11d48')
    const up = slackPayload(ev({ kind: 'recovered', cause: null })) as { attachments: { color: string }[] }
    expect(up.attachments[0]!.color).toBe('#059669')
  })
})

describe('emailPayload', () => {
  it('drops the emoji from the subject and escapes HTML', () => {
    const p = emailPayload(
      ev({ monitor: { ...monitor, name: '<script>x</script>' } }),
      'Uptime <u@x.test>',
      'a@hiyield.co.uk'
    )
    expect(p.subject).toBe('<script>x</script> is DOWN')
    expect(p.to).toEqual(['a@hiyield.co.uk'])
    expect(p.html).not.toContain('<script>')
    expect(p.html).toContain('&lt;script&gt;')
    expect(p.text).toContain('Error: HTTP 503')
  })
})

describe('createSender', () => {
  const noSleep = async () => {}

  it('posts Slack payloads to the webhook', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch: FetchFn = async (url, init) => {
      calls.push({ url, init })
      return new Response('ok', { status: 200 })
    }
    const send = createSender({ fetch, resendApiKey: 'rk', mailFrom: 'f@x.test', sleep: noSleep })
    const r = await send(slack, ev({}))
    expect(r).toEqual({ ok: true, attempts: 1, error: null })
    expect(calls[0]!.url).toBe(slack.target)
    expect(JSON.parse(calls[0]!.init!.body as string).text).toBe('🔴 Acme is DOWN')
  })

  it('posts email to Resend with a bearer key', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch: FetchFn = async (url, init) => {
      calls.push({ url, init })
      return new Response('{"id":"e1"}', { status: 200 })
    }
    const send = createSender({ fetch, resendApiKey: 'rk', mailFrom: 'f@x.test', sleep: noSleep })
    await send(email, ev({}))
    expect(calls[0]!.url).toBe('https://api.resend.com/emails')
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer rk')
    expect(JSON.parse(calls[0]!.init!.body as string).to).toEqual(['logan@hiyield.co.uk'])
  })

  it('retries failures and reports every attempt', async () => {
    let n = 0
    const fetch: FetchFn = async () => {
      n += 1
      return n < 3 ? new Response('nope', { status: 500 }) : new Response('ok', { status: 200 })
    }
    const sleeps: number[] = []
    const attempts: AttemptRecord[] = []
    const send = createSender({
      fetch,
      resendApiKey: 'rk',
      mailFrom: 'f@x.test',
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    })
    const r = await send(slack, ev({}), async (a) => {
      attempts.push(a)
    })
    expect(r).toEqual({ ok: true, attempts: 3, error: null })
    expect(attempts.map((a) => a.ok)).toEqual([false, false, true])
    expect(attempts[0]!.error).toBe('Slack responded 500: nope')
    expect(sleeps).toEqual([500, 1000])
  })

  it('gives up after 3 attempts with the last error', async () => {
    const fetch: FetchFn = async () => new Response('invalid_token', { status: 404 })
    const send = createSender({ fetch, resendApiKey: 'rk', mailFrom: 'f@x.test', sleep: noSleep })
    const r = await send(slack, ev({}))
    expect(r).toEqual({ ok: false, attempts: 3, error: 'Slack responded 404: invalid_token' })
  })

  it('treats a thrown fetch as a failed attempt', async () => {
    const fetch: FetchFn = async () => {
      throw new Error('Network connection lost.')
    }
    const send = createSender({
      fetch,
      resendApiKey: 'rk',
      mailFrom: 'f@x.test',
      sleep: noSleep,
      maxAttempts: 1
    })
    expect(await send(email, ev({}))).toEqual({ ok: false, attempts: 1, error: 'Network connection lost.' })
  })
})
