export default defineEventHandler(async (event) => ({
  windows: await listMaintenance(useDb(event), Date.now())
}))
