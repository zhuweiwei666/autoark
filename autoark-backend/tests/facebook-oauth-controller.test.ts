jest.mock('../src/services/facebook.oauth.service', () => ({
  validateOAuthConfig: jest.fn(),
  getFacebookLoginUrl: jest.fn(),
  handleOAuthCallback: jest.fn(),
  getBusinessLoginConfigStatus: jest.fn(),
}))

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}))

import * as oauthService from '../src/services/facebook.oauth.service'
import { getLoginUrl, getOAuthConfig, handleCallback } from '../src/controllers/facebook.oauth.controller'

const mockOAuthService = oauthService as jest.Mocked<typeof oauthService>

const responseMock = () => ({
  json: jest.fn(),
  status: jest.fn().mockReturnThis(),
  redirect: jest.fn(),
})

const nextMock = jest.fn()

describe('Facebook OAuth controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOAuthService.validateOAuthConfig.mockResolvedValue({
      valid: true,
      missing: [],
      hasDbApps: true,
    })
    mockOAuthService.getBusinessLoginConfigStatus.mockResolvedValue({
      configured: false,
      source: 'none',
      envConfigured: false,
      activeDbConfiguredAppCount: 0,
    })
  })

  it('sanitizes login URL query parameters before calling the OAuth service', async () => {
    mockOAuthService.getFacebookLoginUrl.mockResolvedValue('https://facebook.example/oauth')
    const res = responseMock()

    await getLoginUrl({
      query: {
        state: { $ne: 'bulk-ad|attacker' },
        appId: ['2165550037551429'],
      },
    } as any, res as any, nextMock as any)

    expect(mockOAuthService.getFacebookLoginUrl).toHaveBeenCalledWith(undefined, undefined)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { loginUrl: 'https://facebook.example/oauth' },
    })
  })

  it('allows a super admin to generate a Business Login URL for an explicit app validation', async () => {
    mockOAuthService.getFacebookLoginUrl.mockResolvedValue('https://facebook.example/oauth')
    const res = responseMock()

    await getLoginUrl({
      user: { role: 'super_admin' },
      query: {
        appId: '1688691382308509',
        adminTest: 'true',
        businessLogin: 'true',
      },
    } as any, res as any, nextMock as any)

    expect(mockOAuthService.getFacebookLoginUrl).toHaveBeenCalledWith(
      undefined,
      '1688691382308509',
      {
        businessLogin: true,
        requirePublicOauthReady: false,
      },
    )
  })

  it('rejects the administrator validation bypass for non-super-admin users', async () => {
    const res = responseMock()

    await getLoginUrl({
      user: { role: 'org_admin' },
      query: {
        appId: '1688691382308509',
        adminTest: 'true',
      },
    } as any, res as any, nextMock as any)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(mockOAuthService.getFacebookLoginUrl).not.toHaveBeenCalled()
  })

  it('passes sanitized OAuth callback code and state to the OAuth service', async () => {
    mockOAuthService.handleOAuthCallback.mockResolvedValue({
      tokenId: 'token_1',
      fbUserId: 'fb_1',
      fbUserName: '测试 用户',
      accessToken: 'access_token',
      userDetails: { email: 'customer@example.com' },
    } as any)
    const res = responseMock()

    await handleCallback({
      query: {
        code: '  auth_code  ',
        state: '  bulk-ad|user_1|org_1  ',
      },
    } as any, res as any, nextMock as any)

    expect(mockOAuthService.handleOAuthCallback).toHaveBeenCalledWith('auth_code', 'bulk-ad|user_1|org_1')
    const redirectUrl = new URL(`https://app.autoark.work${res.redirect.mock.calls[0][0]}`)
    expect(redirectUrl.pathname).toBe('/oauth/callback')
    expect(redirectUrl.searchParams.get('oauth_success')).toBe('true')
    expect(redirectUrl.searchParams.get('fb_user_name')).toBe('测试 用户')
    expect(redirectUrl.searchParams.get('fb_user_email')).toBe('customer@example.com')
  })

  it('does not process malformed callback code query objects', async () => {
    const res = responseMock()

    await handleCallback({
      query: {
        code: { $gt: '' },
        state: { $ne: 'bulk-ad|user_1|org_1' },
      },
    } as any, res as any, nextMock as any)

    expect(mockOAuthService.handleOAuthCallback).not.toHaveBeenCalled()
    const redirectUrl = new URL(`https://app.autoark.work${res.redirect.mock.calls[0][0]}`)
    expect(redirectUrl.pathname).toBe('/fb-token')
    expect(redirectUrl.searchParams.get('oauth_error')).toBe('No authorization code received')
  })

  it('reports database-backed Business Login config status', async () => {
    mockOAuthService.getBusinessLoginConfigStatus.mockResolvedValue({
      configured: true,
      source: 'database',
      envConfigured: false,
      activeDbConfiguredAppCount: 1,
    })
    const res = responseMock()

    await getOAuthConfig({} as any, res as any, nextMock as any)

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        configured: true,
        hasDbApps: true,
        businessLoginConfigIdConfigured: true,
        businessLoginConfigIdSource: 'database',
        businessLoginEnvConfigured: false,
        activeDbBusinessLoginConfigAppCount: 1,
      }),
    })
  })
})
