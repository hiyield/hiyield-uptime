import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { Db } from './db'

/** Replaces the incident's note and records who wrote it. Returns false if the incident doesn't exist. */
export async function setIncidentNote(
  db: Db,
  incidentId: string,
  note: string,
  by: string,
  now: number
): Promise<boolean> {
  const existing = await db.query.incidents.findFirst({
    columns: { id: true },
    where: eq(schema.incidents.id, incidentId)
  })
  if (!existing) return false
  await db
    .update(schema.incidents)
    .set({ note, noteBy: by, noteAt: now })
    .where(eq(schema.incidents.id, incidentId))
  return true
}
