import { sanitizeLogValue } from '../src/utils/logger'

describe('logger redaction', () => {
  it('redacts sensitive keys while preserving diagnostic ids', () => {
    const sanitized = sanitizeLogValue({
      token: 'EAA_REAL_TOKEN',
      accessToken: 'tt_access',
      refresh_token: 'tt_refresh',
      password: 'secret-password',
      appSecret: 'app-secret',
      tokenId: '665000000000000000000001',
      tokenCount: 2,
    })

    expect(sanitized.token).toBe('[REDACTED]')
    expect(sanitized.accessToken).toBe('[REDACTED]')
    expect(sanitized.refresh_token).toBe('[REDACTED]')
    expect(sanitized.password).toBe('[REDACTED]')
    expect(sanitized.appSecret).toBe('[REDACTED]')
    expect(sanitized.tokenId).toBe('665000000000000000000001')
    expect(sanitized.tokenCount).toBe(2)
  })

  it('summarizes axios errors without logging request tokens', () => {
    const error: any = new Error('Request failed with Bearer EAA_REAL_TOKEN')
    error.isAxiosError = true
    error.code = 'ERR_BAD_REQUEST'
    error.config = {
      method: 'get',
      url: 'https://graph.facebook.com/v21.0/me?fields=id&access_token=EAA_REAL_TOKEN',
      params: { access_token: 'EAA_REAL_TOKEN' },
    }
    error.response = {
      status: 400,
      data: {
        error: {
          code: 190,
          error_subcode: 460,
          type: 'OAuthException',
          message: 'Token expired',
        },
      },
    }

    const sanitized = sanitizeLogValue(error)
    const serialized = JSON.stringify(sanitized)

    expect(sanitized.status).toBe(400)
    expect(sanitized.response.code).toBe(190)
    expect(sanitized.url).toContain('access_token=%5BREDACTED%5D')
    expect(serialized).not.toContain('EAA_REAL_TOKEN')
    expect(serialized).not.toContain('params')
  })
})
