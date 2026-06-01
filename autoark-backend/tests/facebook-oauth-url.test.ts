describe('Facebook OAuth login URL generation', () => {
  const loadOauthApi = async (appConfig: any, env: Record<string, string> = {}) => {
    jest.resetModules()
    process.env.FACEBOOK_APP_ID = env.FACEBOOK_APP_ID || ''
    process.env.FACEBOOK_APP_SECRET = env.FACEBOOK_APP_SECRET || ''
    process.env.FACEBOOK_REDIRECT_URI =
      env.FACEBOOK_REDIRECT_URI || 'https://app.autoark.work/api/facebook/oauth/callback'
    process.env.FACEBOOK_BULK_AD_REDIRECT_URI =
      env.FACEBOOK_BULK_AD_REDIRECT_URI || 'https://app.autoark.work/api/bulk-ad/auth/callback'
    process.env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID = env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID || ''

    jest.doMock('../src/models/FacebookApp', () => ({
      __esModule: true,
      default: {
        findOne: jest.fn().mockResolvedValue(appConfig),
        countDocuments: jest.fn().mockResolvedValue(appConfig ? 1 : 0),
      },
    }))

    return import('../src/integration/facebook/oauth.api')
  }

  afterEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('uses Facebook Login for Business config_id without scope when configured', async () => {
    const oauthApi = await loadOauthApi({
      appId: '2165550037551429',
      appSecret: 'secret',
      config: { businessLoginConfigId: '1544502593866149' },
    })

    const loginUrl = await oauthApi.getFacebookLoginUrl('bulk-ad|user|org', '2165550037551429', {
      businessLogin: true,
      redirectUri: oauthApi.getFacebookBulkAdRedirectUri(),
    })
    const url = new URL(loginUrl)
    const state = oauthApi.parseStateParam(url.searchParams.get('state') || '')

    expect(url.searchParams.get('client_id')).toBe('2165550037551429')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.autoark.work/api/bulk-ad/auth/callback')
    expect(url.searchParams.get('config_id')).toBe('1544502593866149')
    expect(url.searchParams.get('override_default_response_type')).toBe('true')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.has('scope')).toBe(false)
    expect(state).toEqual({
      originalState: 'bulk-ad|user|org',
      appId: '2165550037551429',
      redirectUri: 'https://app.autoark.work/api/bulk-ad/auth/callback',
    })
  })

  it('falls back to scope-based OAuth when no business config_id exists', async () => {
    const oauthApi = await loadOauthApi({
      appId: '2165550037551429',
      appSecret: 'secret',
      config: {},
    })

    const loginUrl = await oauthApi.getFacebookLoginUrl('state', '2165550037551429', {
      businessLogin: true,
    })
    const url = new URL(loginUrl)

    expect(url.searchParams.has('config_id')).toBe(false)
    expect(url.searchParams.get('auth_type')).toBe('rerequest')
    expect(url.searchParams.get('scope')?.split(',')).toEqual([
      'ads_management',
      'ads_read',
      'business_management',
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_ads',
    ])
  })
})
