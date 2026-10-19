export default defineEventHandler(async (event) => ({ tags: await listTags(useDb(event)) }))
