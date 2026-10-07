import { describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { maintenanceSchema } from '../../shared/utils/validation'

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return { ...actual, readBody: vi.fn() }
})

const { readBody } = await import('h3')
const { validateBody } = await import('../../server/utils/validateBody')

const fakeEvent = {} as H3Event

describe('validateBody', () => {
  it('throws the real Zod refine message as message, with an ASCII-safe statusMessage', async () => {
    vi.mocked(readBody).mockResolvedValue({ monitorId: null, startsAt: 100, endsAt: 100 })
    await expect(validateBody(fakeEvent, maintenanceSchema)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Validation failed',
      message: 'End must be after start'
    })
  })

  it('keeps non-ASCII characters in the message (h3 strips them from statusMessage)', async () => {
    vi.mocked(readBody).mockResolvedValue({ name: 'x' })
    const schema = z.object({ name: z.string().min(3, 'Too short — use 3+ characters…') })
    await expect(validateBody(fakeEvent, schema)).rejects.toMatchObject({
      statusMessage: 'Validation failed',
      message: 'Too short — use 3+ characters…'
    })
  })

  it('returns the parsed output for a valid body', async () => {
    vi.mocked(readBody).mockResolvedValue({ monitorId: null, startsAt: 100, endsAt: 200, note: 'x' })
    await expect(validateBody(fakeEvent, maintenanceSchema)).resolves.toEqual({
      monitorId: null,
      startsAt: 100,
      endsAt: 200,
      note: 'x'
    })
  })
})
