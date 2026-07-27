const mockFacebookGet = jest.fn()

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: mockFacebookGet,
  },
}))

import { validateSystemUserToken } from '../src/services/metaBusinessCredential.service'

const requiredScopes = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
]

describe('Meta System User token validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('accepts a valid token only after required scopes and direct asset access are verified', async () => {
    mockFacebookGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/debug_token') {
        return {
          data: {
            is_valid: true,
            scopes: requiredScopes,
          },
        }
      }
      return { id: '123', name: 'Asset' }
    })

    const result = await validateSystemUserToken(
      'SYSTEM_TOKEN',
      { appId: 'app-id', appSecret: 'app-secret' },
      [{ kind: 'adAccounts', assetId: '123' }],
    )

    expect(result.checks).toEqual([
      { kind: 'adAccounts', assetId: '123', ok: true },
    ])
    expect(mockFacebookGet).toHaveBeenCalledTimes(2)
  })

  it('rejects a token that Meta reports as missing a required publishing scope', async () => {
    mockFacebookGet.mockResolvedValue({
      data: {
        is_valid: true,
        scopes: requiredScopes.filter((scope) => scope !== 'ads_management'),
      },
    })

    await expect(validateSystemUserToken(
      'SYSTEM_TOKEN',
      { appId: 'app-id', appSecret: 'app-secret' },
      [{ kind: 'adAccounts', assetId: '123' }],
    )).rejects.toThrow(
      'Generated System User token is missing required scopes: ads_management',
    )
    expect(mockFacebookGet).toHaveBeenCalledTimes(1)
  })

  it('rejects a token that Meta explicitly reports as invalid', async () => {
    mockFacebookGet.mockResolvedValue({
      data: {
        is_valid: false,
        scopes: requiredScopes,
      },
    })

    await expect(validateSystemUserToken(
      'SYSTEM_TOKEN',
      { appId: 'app-id', appSecret: 'app-secret' },
      [{ kind: 'adAccounts', assetId: '123' }],
    )).rejects.toThrow('Generated System User token is not valid')
    expect(mockFacebookGet).toHaveBeenCalledTimes(1)
  })
})
