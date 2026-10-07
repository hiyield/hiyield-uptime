import { eq, gte, lt, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { bucket30m, dayStart } from '../engine/rollup'
import {
  CHECK_RETENTION_DAYS,
  DAY_MS,
  ROLLUP_30M_RETENTION_DAYS,
  ROLLUP_DAILY_RETENTION_DAYS
} from '../../shared/utils/constants'
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
 * 30-minute rows only within their retention window. The oldest day is skipped when raw pruning
 * has already cut into it, so a complete live-written row is never replaced by a partial one.
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
  let fromDay = dayStart(min)
  const rawPruneEdge = now - CHECK_RETENTION_DAYS * DAY_MS
  if (min > fromDay && fromDay < rawPruneEdge + DAY_MS) fromDay += DAY_MS

  await db.delete(schema.rollup30m).where(gte(schema.rollup30m.bucketStart, from30m))
  await db.run(sql`insert into rollup_30m (monitor_id, bucket_start, checks, failures, blips, maintenance, resp_sum, resp_count, resp_max)
    select monitor_id, (checked_at / 1800000) * 1800000, ${AGGREGATES}
    from checks where region = 'primary' and checked_at >= ${from30m}
    group by monitor_id, (checked_at / 1800000) * 1800000`)

  await db.delete(schema.rollupDaily).where(gte(schema.rollupDaily.dayStart, fromDay))
  await db.run(sql`insert into rollup_daily (monitor_id, day_start, checks, failures, blips, maintenance, resp_sum, resp_count, resp_max)
    select monitor_id, (checked_at / 86400000) * 86400000, ${AGGREGATES}
    from checks where region = 'primary' and checked_at >= ${fromDay}
    group by monitor_id, (checked_at / 86400000) * 86400000`)

  return { from30m, fromDay }
}
