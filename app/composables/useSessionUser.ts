export interface SessionUser {
  id: string
  name: string
  email: string
}

/**
 * Session fetched once per page load (sign-in/out always leave via a full navigation).
 * Uses useRequestFetch so the cookie is forwarded during SSR.
 */
export function useSessionUser() {
  const user = useState<SessionUser | null | undefined>('session-user', () => undefined)

  async function fetchUser(): Promise<SessionUser | null> {
    if (user.value !== undefined) return user.value
    const session = await useRequestFetch()<{ user?: SessionUser } | null>('/api/auth/get-session')
    user.value = session?.user ?? null
    return user.value
  }

  return { user, fetchUser }
}
