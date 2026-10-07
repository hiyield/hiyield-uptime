import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  await useDb(event)
    .delete(schema.contacts)
    .where(eq(schema.contacts.id, getRouterParam(event, 'id')!))
  return { ok: true }
})
