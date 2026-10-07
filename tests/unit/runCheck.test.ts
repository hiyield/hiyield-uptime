import { describe, expect, it } from 'vitest'
import { classifyError, runCheck, USER_AGENT } from '../../server/engine/runCheck'
import type { FetchFn } from '../../server/engine/types'

const respond =
  (status: number): FetchFn =>
  async () =>
    new Response('body', { status })

const throwing =
  (err: Error): FetchFn =>
  async () => {
    throw err
  }

/** Never resolves on its own; rejects with AbortError when the signal fires — like real fetch. */
const hanging: FetchFn = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })

function clock(...times: number[]) {
  let i = 0
  return () => times[Math.min(i++, times.length - 1)]!
}

describe('runCheck', () => {
  it('2xx is up with status and response time', async () => {
    const r = await runCheck('https://a.example', {
      timeoutMs: 1000,
      fetch: respond(200),
      now: clock(1000, 1250)
    })
    expect(r).toEqual({ ok: true, statusCode: 200, responseMs: 250, error: null, checkedAt: 1000 })
  })

  it('3xx final status is up', async () => {
    const r = await runCheck('https://a.example', { timeoutMs: 1000, fetch: respond(302) })
    expect(r.ok).toBe(true)
  })

  it('final status after redirects decides: 404 is down', async () => {
    const r = await runCheck('https://a.example', { timeoutMs: 1000, fetch: respond(404) })
    expect(r).toMatchObject({ ok: false, statusCode: 404, error: 'HTTP 404' })
  })

  it('5xx is down', async () => {
    const r = await runCheck('https://a.example', { timeoutMs: 1000, fetch: respond(503) })
    expect(r).toMatchObject({ ok: false, statusCode: 503, error: 'HTTP 503' })
  })

  it('times out', async () => {
    const r = await runCheck('https://a.example', { timeoutMs: 50, fetch: hanging })
    expect(r).toMatchObject({ ok: false, statusCode: null, responseMs: null, error: 'Timeout after 0s' })
  })

  it('DNS failure is down with a readable error', async () => {
    const r = await runCheck('https://a.example', {
      timeoutMs: 1000,
      fetch: throwing(new Error('getaddrinfo ENOTFOUND a.example'))
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^DNS lookup failed/)
  })

  it('TLS failure is down with a readable error', async () => {
    const r = await runCheck('https://a.example', {
      timeoutMs: 1000,
      fetch: throwing(new Error('SSL certificate has expired'))
    })
    expect(r.error).toMatch(/^TLS error/)
  })

  it('sends GET with redirect follow and our user agent', async () => {
    let seen: RequestInit | undefined
    const spy: FetchFn = async (_u, init) => {
      seen = init
      return new Response('', { status: 200 })
    }
    await runCheck('https://a.example', { timeoutMs: 1000, fetch: spy })
    expect(seen?.method).toBe('GET')
    expect(seen?.redirect).toBe('follow')
    expect((seen?.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT)
  })
})

describe('classifyError', () => {
  it('formats timeouts in whole seconds', () => {
    expect(classifyError(new DOMException('x', 'AbortError'), 10_000)).toBe('Timeout after 10s')
  })
  it('falls back to connection error', () => {
    expect(classifyError(new Error('Network connection lost.'), 10_000)).toBe(
      'Connection error: Network connection lost.'
    )
  })
})
