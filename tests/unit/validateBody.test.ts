import { describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { maintenanceSchema } from '../../shared/utils/validation'

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return { ...actual, readBody: vi.fn() }
})

const { readBody } = await import('h3')
const { validateBody } = await import('../../server/utils/validateBody')

const fakeEvent = {} as H3Event

describe('validateBody', () => {
  it('throws the real Zod refine message as statusMessage, not a generic one', async () => {
    vi.mocked(readBody).mockResolvedValue({ monitorId: null, startsAt: 100, endsAt: 100 })
    await expect(validateBody(fakeEvent, maintenanceSchema)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'End must be after start'
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
