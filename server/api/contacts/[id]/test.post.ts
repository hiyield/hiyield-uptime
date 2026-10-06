import { eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { createSender } from '../../../engine/notify'

export default defineEventHandler(async (event) => {
  const env = event.context.cloudflare.env
  const db = useDb(event)
  const contact = await db.query.contacts.findFirst({
    where: eq(schema.contacts.id, getRouterParam(event, 'id')!)
  })
  if (!contact) throw createError({ statusCode: 404, statusMessage: 'Contact not found' })
  const send = createSender({
    fetch: (input, init) => fetch(input, init),
    resendApiKey: env.RESEND_API_KEY,
    mailFrom: env.MAIL_FROM
  })
  return send(
    contact,
    { kind: 'test', monitor: null, cause: null, downForMs: null, dashboardUrl: env.PUBLIC_BASE_URL },
    async (a) => {
      await db.insert(schema.alertDeliveries).values({
        id: crypto.randomUUID(),
        contactId: contact.id,
        kind: 'test',
        attempt: a.attempt,
        ok: a.ok,
        error: a.error,
        sentAt: Date.now()
      })
    }
  )
})
