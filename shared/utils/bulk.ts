import { normaliseUrl, URL_ERROR } from './validation'

export interface BulkRow {
  line: number
  name: string
  url: string
  error: string | null
}

export const ALREADY_MONITORED = 'Already monitored'

/**
 * One site per line: `name, url`. Splits on the FIRST comma so URLs may contain commas.
 * Blank lines and lines starting with # are skipped. Line numbers are 1-based.
 * `existingUrls` (already normalised, as stored) flags sites that are already monitors.
 */
export function parseBulk(text: string, existingUrls: Iterable<string> = []): BulkRow[] {
  const existing = new Set(existingUrls)
  const rows: BulkRow[] = []
  const seen = new Map<string, number>()
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const comma = trimmed.indexOf(',')
    if (comma === -1) {
      rows.push({ line, name: trimmed, url: '', error: 'Expected: name, url' })
      return
    }
    const name = trimmed.slice(0, comma).trim()
    const rawUrl = trimmed.slice(comma + 1).trim()
    const url = normaliseUrl(rawUrl)
    let error: string | null = null
    if (!name) error = 'Name is required'
    else if (!url) error = URL_ERROR
    else if (existing.has(url)) error = ALREADY_MONITORED
    else if (seen.has(url)) error = `Duplicate URL (line ${seen.get(url)})`
    if (url && !seen.has(url)) seen.set(url, line)
    rows.push({ line, name, url: url ?? rawUrl, error })
  })
  return rows
}
