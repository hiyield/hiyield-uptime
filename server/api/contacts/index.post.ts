import * as schema from '../../db/schema'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, contactCreateSchema.parse)
  const id = crypto.randomUUID()
  await useDb(event)
    .insert(schema.contacts)
    .values({ id, ...input, createdAt: Date.now() })
  return { id }
})
