// Forwards /api/auth/* (sign-in, Google callback, get-session, sign-out) to Better Auth.
export default defineEventHandler((event) => serverAuth(event).handler(toWebRequest(event)))
