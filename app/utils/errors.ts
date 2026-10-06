/** Best human-readable message from a $fetch / H3 error. */
export function errorMessage(e: unknown): string {
  const err = e as {
    data?: { statusMessage?: string; message?: string }
    statusMessage?: string
    message?: string
  }
  return (
    err?.data?.statusMessage ??
    err?.data?.message ??
    err?.statusMessage ??
    err?.message ??
    'Something went wrong'
  )
}
