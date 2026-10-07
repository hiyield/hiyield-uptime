/**
 * Best human-readable message from a $fetch / H3 error. `data.message` first: it carries the full
 * text, while h3 strips non-ASCII from `statusMessage`. (createError defaults `message` to
 * `statusMessage`, so routes that only set `statusMessage` still read correctly.)
 */
export function errorMessage(e: unknown): string {
  const err = e as {
    data?: { statusMessage?: string; message?: string }
    statusMessage?: string
    message?: string
  }
  return (
    err?.data?.message ??
    err?.data?.statusMessage ??
    err?.statusMessage ??
    err?.message ??
    'Something went wrong'
  )
}
