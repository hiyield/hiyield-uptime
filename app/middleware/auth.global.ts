export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const { fetchUser } = useSessionUser()
  const user = await fetchUser()
  if (!user) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
})
