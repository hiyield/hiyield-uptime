export default defineEventHandler(async (event) => getBoard(useDb(event), Date.now()))
