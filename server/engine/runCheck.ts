import type { CheckResult, FetchFn } from './types'

export const USER_AGENT = 'HiyieldUptime/1.0 (+https://hiyield.co.uk)'

export interface RunCheckOptions {
  timeoutMs: number
  fetch?: FetchFn
  now?: () => number
}

/** One HTTP check. Never throws — every failure becomes a down result with an `error` string. */
export async function runCheck(url: string, opts: RunCheckOptions): Promise<CheckResult> {
  const fetchFn: FetchFn = opts.fetch ?? ((input, init) => fetch(input, init))
  const now = opts.now ?? Date.now
  const started = now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT }
    })
    const responseMs = now() - started
    // Free the connection; we only need the status.
    await res.body?.cancel().catch(() => {})
    const ok = res.status < 400
    return {
      ok,
      statusCode: res.status,
      responseMs,
      error: ok ? null : `HTTP ${res.status}`,
      checkedAt: started
    }
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      responseMs: null,
      error: classifyError(err, opts.timeoutMs),
      checkedAt: started
    }
  } finally {
    clearTimeout(timer)
  }
}

export function classifyError(err: unknown, timeoutMs: number): string {
  const e = err instanceof Error ? err : new Error(String(err))
  if (e.name === 'AbortError' || e.name === 'TimeoutError') {
    return `Timeout after ${Math.round(timeoutMs / 1000)}s`
  }
  if (/dns|resolve|ENOTFOUND|getaddrinfo/i.test(e.message)) return `DNS lookup failed: ${e.message}`
  if (/tls|ssl|certificate|handshake/i.test(e.message)) return `TLS error: ${e.message}`
  return `Connection error: ${e.message}`
}
