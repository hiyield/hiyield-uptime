/** Shared by stats.ts and boardCharts.ts — kept separate to avoid a module cycle between them. */
export function uptimePercent(total: number, failures: number): number | null {
  if (total === 0) return null
  return Math.round(((total - failures) / total) * 10_000) / 100
}
