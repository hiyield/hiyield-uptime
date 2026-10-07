import { eq, gt, gte, lt, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { bucket30m, dayStart } from '../engine/rollup'
import { DAY_MS, ROLLUP_30M_RETENTION_DAYS, ROLLUP_DAILY_RETENTION_DAYS } from '../../shared/utils/constants'
import type { Db } from './db'

export async function pruneRollups(db: Db, now: number): Promise<void> {
  await db
    .delete(schema.rollup30m)
    .where(lt(schema.rollup30m.bucketStart, now - ROLLUP_30M_RETENTION_DAYS * DAY_MS))
  await db
    .delete(schema.rollupDaily)
    .where(lt(schema.rollupDaily.dayStart, now - ROLLUP_DAILY_RETENTION_DAYS * DAY_MS))
}

const AGGREGATES = sql.raw(`count(*),
  sum(case when ok = 0 and confirmed = 1 and maintenance = 0 then 1 else 0 end),
  sum(case when ok = 0 and confirmed = 0 and maintenance = 0 then 1 else 0 end),
  sum(case when maintenance = 1 then 1 else 0 end),
  coalesce(sum(response_ms), 0),
  count(response_ms),
  coalesce(max(response_ms), 0)`)

/**
 * Rebuilds rollups from raw primary checks. Idempotent (delete-then-insert over the rebuilt range).
 * 30-minute rows only within their retention window.
 *
 * The oldest day (which raw-check retention may have already partially pruned) is handled
 * separately: any later days are fully deleted and rebuilt, but the oldest day's existing row —
 * if one exists from a prior live write or backfill — is left untouched (`ON CONFLICT DO NOTHING`),
 * so a complete, live-written row is never replaced by one rebuilt from a partially-pruned day.
 * Only when no row exists yet for that day (e.g. the very first backfill) is it filled from
 * whatever raw data remains.
 *
 * Run once after deploying rollups; avoid running while monitors are mid-tick in that range.
 */
export async function backfillRollups(
  db: Db,
  now: number
): Promise<{ from30m: number | null; fromDay: number | null }> {
  const [row] = await db
    .select({ min: sql<number | null>`min(${schema.checks.checkedAt})` })
    .from(schema.checks)
    .where(eq(schema.checks.region, 'primary'))
  const min = row?.min == null ? null : Number(row.min)
  if (min === null) return { from30m: null, fromDay: null }

  const from30m = Math.max(bucket30m(min), bucket30m(now - ROLLUP_30M_RETENTION_DAYS * DAY_MS))
  const oldestDay = dayStart(min)

  await db.delete(schema.rollup30m).where(gte(schema.rollup30m.bucketStart, from30m))
  await db.run(sql`insert into rollup_30m (monitor_id, bucket_start, checks, failures, blips, maintenance, resp_sum, resp_count, resp_max)
    select monitor_id, (checked_at / 1800000) * 1800000, ${AGGREGATES}
    from checks where region = 'primary' and checked_at >= ${from30m}
    group by monitor_id, (checked_at / 1800000) * 1800000`)

  await db.delete(schema.rollupDaily).where(gt(schema.rollupDaily.dayStart, oldestDay))
  await db.run(sql`insert into rollup_daily (monitor_id, day_start, checks, failures, blips, maintenance, resp_sum, resp_count, resp_max)
    select monitor_id, (checked_at / 86400000) * 86400000, ${AGGREGATES}
    from checks where region = 'primary' and checked_at >= ${oldestDay + DAY_MS}
    group by monitor_id, (checked_at / 86400000) * 86400000`)

  // The oldest day may already have a complete, live-written row — never overwrite it with one
  // rebuilt from a partially-pruned day. Only fills it in when it doesn't exist yet.
  await db.run(sql`insert into rollup_daily (monitor_id, day_start, checks, failures, blips, maintenance, resp_sum, resp_count, resp_max)
    select monitor_id, ${oldestDay}, ${AGGREGATES}
    from checks where region = 'primary' and checked_at >= ${oldestDay} and checked_at < ${oldestDay + DAY_MS}
    group by monitor_id
    on conflict (monitor_id, day_start) do nothing`)

  return { from30m, fromDay: oldestDay }
}
