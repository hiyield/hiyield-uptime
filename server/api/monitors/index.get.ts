export default defineEventHandler(async (event) => ({ monitors: await listBoard(useDb(event), Date.now()) }))
