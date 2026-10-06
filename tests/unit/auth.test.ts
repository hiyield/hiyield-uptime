import { describe, expect, it } from 'vitest'
import { assertAllowedSignup } from '../../server/utils/allowedSignup'
import { isPublicApiPath } from '../../server/utils/publicPath'

describe('assertAllowedSignup', () => {
  it('allows hiyield.co.uk', () => {
    expect(() => assertAllowedSignup('logan@hiyield.co.uk')).not.toThrow()
  })
  it('rejects anyone else with a clear message', () => {
    expect(() => assertAllowedSignup('someone@gmail.com')).toThrow(/Only @hiyield.co.uk Google accounts/)
  })
})

describe('isPublicApiPath', () => {
  it('lets auth and cron through', () => {
    expect(isPublicApiPath('/api/auth/sign-in/social')).toBe(true)
    expect(isPublicApiPath('/api/auth/callback/google')).toBe(true)
    expect(isPublicApiPath('/api/cron/prune')).toBe(true)
  })
  it('protects everything else', () => {
    expect(isPublicApiPath('/api/monitors')).toBe(false)
    expect(isPublicApiPath('/api/authx')).toBe(false)
    expect(isPublicApiPath('/api/contacts/1/test')).toBe(false)
  })
})
