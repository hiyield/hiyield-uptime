import { betterAuth } from 'better-auth'
import { getRequestURL, type H3Event } from 'h3'
import { assertAllowedSignup } from './allowedSignup'

/**
 * Better Auth per request (bindings are request-scoped on Workers — same as qa).
 * Google only. `hd` makes Google's account picker prefer Hiyield accounts; the
 * create hook is what actually enforces the domain.
 */
export function serverAuth(event: H3Event) {
  const env = event.context.cloudflare?.env
  if (!env?.DB) throw new Error('D1 binding DB not found on event.context.cloudflare.env')

  // In dev, trust the origin the request came from (nuxt dev :3000 or cf:dev :8787).
  const devOrigin = import.meta.dev ? getRequestURL(event).origin : null

  return betterAuth({
    database: env.DB,
    baseURL: devOrigin ?? env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
        hd: 'hiyield.co.uk'
      }
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            assertAllowedSignup(user.email)
            return { data: user }
          }
        }
      }
    }
  })
}
