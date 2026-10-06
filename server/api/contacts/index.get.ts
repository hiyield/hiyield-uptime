export default defineEventHandler(async (event) => ({ contacts: await listContacts(useDb(event)) }))
