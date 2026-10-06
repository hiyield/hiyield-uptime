import { desc, eq, gt } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { MaintenanceRow } from '../db/schema'
import type { Db } from './db'

export type MaintenanceListItem = MaintenanceRow & { monitorName: string | null }

const RECENT_MS = 30 * 86_400_000

/** Upcoming, active, and anything that ended in the last 30 days. */
export async function listMaintenance(db: Db, now: number): Promise<MaintenanceListItem[]> {
  const w = schema.maintenanceWindows
  const rows = await db
    .select({ window: w, monitorName: schema.monitors.name })
    .from(w)
    .leftJoin(schema.monitors, eq(schema.monitors.id, w.monitorId))
    .where(gt(w.endsAt, now - RECENT_MS))
    .orderBy(desc(w.startsAt))
  return rows.map((r) => ({ ...r.window, monitorName: r.monitorName }))
}
