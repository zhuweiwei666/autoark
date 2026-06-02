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

    const findOne = jest.fn().mockResolvedValue(appConfig)
    jest.doMock('../src/models/FacebookApp', () => ({
      __esModule: true,
      default: {
        findOne,
        countDocuments: jest.fn().mockResolvedValue(appConfig ? 1 : 0),
      },
    }))

    return Object.assign(await import('../src/integration/facebook/oauth.api'), { __findOne: findOne })
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

  it('requires public OAuth readiness when a specific app is used to generate a login URL', async () => {
    const oauthApi = await loadOauthApi({
      appId: '2165550037551429',
      appSecret: 'secret',
      config: { businessLoginConfigId: '1544502593866149' },
    })

    await oauthApi.getFacebookLoginUrl('state', '2165550037551429', {
      businessLogin: true,
    })

    expect((oauthApi as any).__findOne).toHaveBeenCalledWith(expect.objectContaining({
      appId: '2165550037551429',
      status: 'active',
      'validation.isValid': true,
      'compliance.publicOauthReady': true,
      'compliance.appMode': 'live',
      'compliance.businessVerification': 'verified',
      'compliance.appReview': 'approved',
      'config.enabledForBulkAds': { $ne: false },
      'config.businessLoginConfigId': { $exists: true, $nin: ['', null] },
    }))
  })

  it('keeps OAuth callbacks compatible with the original active app from signed state', async () => {
    const oauthApi = await loadOauthApi({
      appId: '2165550037551429',
      appSecret: 'secret',
      config: { businessLoginConfigId: '1544502593866149' },
    })

    await oauthApi.getActiveAppConfigWithOptions('2165550037551429')

    expect((oauthApi as any).__findOne).toHaveBeenCalledWith({
      appId: '2165550037551429',
      status: 'active',
    })
  })

  it('returns a client-facing error when an explicit app is not public OAuth ready', async () => {
    const oauthApi = await loadOauthApi(null)

    await expect(oauthApi.getFacebookLoginUrl('state', '2165550037551429', {
      businessLogin: true,
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'FACEBOOK_APP_PUBLIC_OAUTH_NOT_READY',
      message: expect.stringContaining('尚未满足公开授权条件'),
    })
  })

  it('rejects tampered signed OAuth state when verification is required', async () => {
    const oauthApi = await loadOauthApi({
      appId: '2165550037551429',
      appSecret: 'secret',
      config: {},
    })

    const loginUrl = await oauthApi.getFacebookLoginUrl('bulk-ad|user|org', '2165550037551429', {
      businessLogin: true,
    })
    const url = new URL(loginUrl)
    const state = url.searchParams.get('state') || ''
    const raw = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'))
    raw.originalState = 'bulk-ad|attacker|other-org'
    const tamperedState = Buffer.from(JSON.stringify(raw)).toString('base64url')

    expect(() => oauthApi.parseStateParamWithOptions(tamperedState, { requireSignature: true }))
      .toThrow('Invalid OAuth state')
  })
})
