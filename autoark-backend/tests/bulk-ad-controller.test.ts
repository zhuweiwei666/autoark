jest.mock('../src/services/bulkAd.service', () => ({
  __esModule: true,
  default: {
    createDraft: jest.fn(),
    updateDraft: jest.fn(),
    validateDraft: jest.fn(),
    publishDraft: jest.fn(),
    getTaskSupportPackage: jest.fn(),
    rerunTask: jest.fn(),
  },
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: jest.fn(),
}))

jest.mock('../src/services/facebook.oauth.service', () => ({
  getFacebookBulkAdRedirectUri: jest.fn(),
  getFacebookLoginUrl: jest.fn(),
  handleOAuthCallback: jest.fn(),
  parseStateParamWithOptions: jest.fn(),
}))

jest.mock('../src/services/facebookUser.service', () => ({
  syncFacebookUserAssets: jest.fn(),
  getCachedPixels: jest.fn(),
  getCachedAccounts: jest.fn(),
  getCachedAccountsWithMeta: jest.fn(),
  getCachedCatalogs: jest.fn(),
  getSyncStatus: jest.fn(),
}))

jest.mock('../src/services/facebook.accounts.service', () => ({
  syncCachedAccountsForToken: jest.fn(),
}))

jest.mock('../src/models/FacebookApp', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}))

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    get: jest.fn(),
  },
}))

import bulkAdService from '../src/services/bulkAd.service'
import { writeAuditLog } from '../src/services/auditLog.service'
import * as oauthService from '../src/services/facebook.oauth.service'
import * as facebookUserService from '../src/services/facebookUser.service'
import * as facebookAccountsService from '../src/services/facebook.accounts.service'
import FacebookApp from '../src/models/FacebookApp'
import Account from '../src/models/Account'
import FbToken from '../src/models/FbToken'
import TargetingPackage from '../src/models/TargetingPackage'
import CopywritingPackage from '../src/models/CopywritingPackage'
import CreativeGroup from '../src/models/CreativeGroup'
import { UserRole } from '../src/models/User'
import { facebookClient } from '../src/integration/facebook/facebookClient'
import {
  addMaterial,
  createCopywritingPackage,
  createCreativeGroup,
  createDraft,
  createTargetingPackage,
  deleteCopywritingPackage,
  deleteCreativeGroup,
  deleteTargetingPackage,
  getAuthAdAccounts,
  getAuthPages,
  getAuthPixels,
  getAuthLoginUrl,
  getCopywritingPackageList,
  getCreativeGroupList,
  getFacebookInstagramAccounts,
  getTargetingPackageList,
  handleAuthCallback,
  publishDraft as publishDraftController,
  parseAllCopywritingProducts,
  updateCopywritingPackage,
  updateCreativeGroup,
  updateDraft,
  updateTargetingPackage,
  getTaskSupportPackage,
  removeMaterial,
  rerunTask,
  searchInterests,
  searchLocations,
  validateDraft as validateDraftController,
} from '../src/controllers/bulkAd.controller'

const mockBulkAdService = bulkAdService as jest.Mocked<typeof bulkAdService>
const mockWriteAuditLog = writeAuditLog as jest.Mock
const mockOauthService = oauthService as jest.Mocked<typeof oauthService>
const mockFacebookUserService = facebookUserService as jest.Mocked<typeof facebookUserService>
const mockFacebookAccountsService = facebookAccountsService as jest.Mocked<typeof facebookAccountsService>
const mockFacebookApp = FacebookApp as jest.Mocked<typeof FacebookApp>
const mockFacebookClient = facebookClient as jest.Mocked<typeof facebookClient>

const modelQuery = (value: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
})

const memberReq = (overrides: any = {}) => ({
  params: { id: '665000000000000000000601', ...(overrides.params || {}) },
  body: overrides.body || {},
  query: overrides.query || {},
  user: {
    role: UserRole.MEMBER,
    userId: '665000000000000000000002',
    organizationId: '665000000000000000000001',
    ...(overrides.user || {}),
  },
  get: jest.fn(),
})

const resMock = () => ({
  json: jest.fn(),
  status: jest.fn().mockReturnThis(),
})

const expectMemberControlFilter = (filter: any, id?: string) => {
  const controlFilter = id ? filter.$and?.[1] : filter
  if (id) expect(filter.$and?.[0]).toEqual({ _id: id })

  expect(controlFilter.$and).toHaveLength(2)
  expect(String(controlFilter.$and[0].organizationId)).toBe('665000000000000000000001')
  expect(controlFilter.$and[1].createdBy.$in.map(String)).toEqual(expect.arrayContaining([
    '665000000000000000000002',
  ]))
}

describe('bulk ad controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFacebookClient.get.mockReset()
    mockFacebookUserService.getCachedAccounts.mockResolvedValue([] as any)
    mockFacebookUserService.getCachedAccountsWithMeta.mockResolvedValue({
      accounts: [],
      fetchedPageCount: 0,
      paginationTruncated: false,
    } as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('writes an audit log when draft validation is blocked', async () => {
    const validation = {
      isValid: false,
      errors: [{
        field: 'accounts.123.pixelId',
        message: '账户 Account 123 使用转化目标时必须选择 Pixel',
        severity: 'error',
      }],
      warnings: [],
      validatedAt: new Date('2026-06-01T12:00:00.000Z'),
    }
    mockBulkAdService.validateDraft.mockResolvedValue(validation as any)
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      params: { id: '665000000000000000000010' },
      user: {
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await validateDraftController(req, res)

    expect(mockBulkAdService.validateDraft).toHaveBeenCalledTimes(1)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'bulk_ad',
      action: 'bulk_ad.draft_validate',
      status: 'failed',
      targetType: 'ad_draft',
      targetId: '665000000000000000000010',
      summary: '批量广告草稿预检未通过',
      reason: '账户 Account 123 使用转化目标时必须选择 Pixel',
      metadata: expect.objectContaining({
        isValid: false,
        errorCount: 1,
        warningCount: 0,
        firstErrorField: 'accounts.123.pixelId',
        errorFields: ['accounts.123.pixelId'],
      }),
    }))
    expect(res.json).toHaveBeenCalledWith({ success: true, data: validation })
  })

  it('includes selected Facebook App readiness gaps in login URL diagnostics', async () => {
    const loginUrl = 'https://www.facebook.com/v21.0/dialog/oauth?client_id=2165550037551429&redirect_uri=https%3A%2F%2Fapp.autoark.work%2Fapi%2Fbulk-ad%2Fauth%2Fcallback&config_id=1544502593866149'
    mockOauthService.getFacebookBulkAdRedirectUri.mockReturnValue('https://app.autoark.work/api/bulk-ad/auth/callback')
    mockOauthService.getFacebookLoginUrl.mockResolvedValue(loginUrl)
    ;(mockFacebookApp.findOne as jest.Mock).mockResolvedValue({
      appId: '2165550037551429',
      status: 'active',
      validation: { isValid: true },
      config: { enabledForBulkAds: true, businessLoginConfigId: '1544502593866149' },
      compliance: {
        appMode: 'dev',
        businessVerification: 'verified',
        appReview: 'approved',
        permissions: [
          { name: 'ads_management', access: 'standard', status: 'requested' },
        ],
      },
    })
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      query: {},
      user: {
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      get: jest.fn(),
    }
    const res: any = {
      setHeader: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await getAuthLoginUrl(req, res)

    expect(mockOauthService.getFacebookLoginUrl).toHaveBeenCalledWith(
      'bulk-ad|665000000000000000000002|665000000000000000000001',
      undefined,
      expect.objectContaining({
        businessLogin: true,
        redirectUri: 'https://app.autoark.work/api/bulk-ad/auth/callback',
      }),
    )
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        clientId: '2165550037551429',
        authorizationMode: 'business_login',
        publicOauthReady: false,
        publicOauthGapCount: expect.any(Number),
        publicOauthGapCodes: expect.arrayContaining([
          'APP_MODE_NOT_LIVE',
          'PERMISSION_ADS_MANAGEMENT_NOT_READY',
        ]),
        diagnostics: expect.arrayContaining([
          expect.stringContaining('App Mode 非 Live'),
          expect.stringContaining('ads_management 未通过'),
        ]),
      }),
    })
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'bulk_ad',
      action: 'bulk_ad.facebook_login_url',
      metadata: expect.objectContaining({
        publicOauthReady: false,
        publicOauthGapCodes: expect.arrayContaining(['APP_MODE_NOT_LIVE']),
      }),
    }))
  })

  it('sanitizes draft creation payloads before saving', async () => {
    mockBulkAdService.createDraft.mockResolvedValue({ _id: 'draft_1', name: 'Launch draft' } as any)
    const req = memberReq({
      body: {
        name: '  Launch draft  ',
        status: 'published',
        taskId: '665000000000000000000999',
        validation: { isValid: true },
        estimates: { totalAds: 999 },
        createdBy: 'attacker',
        organizationId: '665000000000000000000099',
        accounts: [{ accountId: 'act_123' }],
        campaign: { nameTemplate: 'camp', budget: 10 },
        adset: { nameTemplate: 'adset', multiplier: 2 },
        ad: { nameTemplate: 'ad' },
        publishStrategy: { schedule: 'IMMEDIATE' },
        notes: '  launch notes  ',
      },
    })
    const res = resMock()

    await createDraft(req as any, res as any)

    const payload = mockBulkAdService.createDraft.mock.calls[0][0]
    expect(payload).toMatchObject({
      name: 'Launch draft',
      accounts: [{ accountId: 'act_123' }],
      campaign: { nameTemplate: 'camp', budget: 10 },
      adset: { nameTemplate: 'adset', multiplier: 2 },
      ad: { nameTemplate: 'ad' },
      publishStrategy: { schedule: 'IMMEDIATE' },
      notes: 'launch notes',
      createdBy: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    })
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('taskId')
    expect(payload).not.toHaveProperty('validation')
    expect(payload).not.toHaveProperty('estimates')
    expect(mockBulkAdService.createDraft.mock.calls[0][1]).toBe('665000000000000000000002')
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'draft_1', name: 'Launch draft' } })
  })

  it('sanitizes nested draft configs before saving', async () => {
    mockBulkAdService.createDraft.mockResolvedValue({ _id: 'draft_1', name: 'Nested draft' } as any)
    const creativeGroupId = '665000000000000000000701'
    const copywritingPackageId = '665000000000000000000702'
    const req = memberReq({
      body: {
        name: 'Nested draft',
        accounts: [
          {
            accountId: ' act_123 ',
            accountName: { $ne: 'Account 123' },
            pageId: ' page_1 ',
            pixelId: ['pixel_1'],
            conversionEvent: ' PURCHASE ',
            extra: 'drop-me',
          },
          { accountId: { $ne: 'act_999' }, pageId: 'page_2' },
        ],
        campaign: {
          nameTemplate: 'camp',
          status: 'DELETE',
          budget: 999_999_999_999,
          budgetOptimization: false,
          budgetType: 'DAILY',
          specialAdCategories: ['NONE', { bad: true }],
          injected: 'drop-me',
        },
        adset: {
          nameTemplate: 'adset',
          multiplier: 999,
          targetingPackageId: 'not-an-object-id',
          inlineTargeting: {
            geo_locations: { countries: ['US'] },
            $where: 'sleep(1)',
            'bad.key': 'drop-me',
            nested: { safe: 'ok', constructor: { prototype: true } },
          },
        },
        ad: {
          nameTemplate: 'ad',
          creativeGroupIds: [creativeGroupId, 'bad-id'],
          copywritingPackageIds: [copywritingPackageId, { $ne: copywritingPackageId }],
          tracking: { websiteEvent: true, urlTags: 'utm_source=autoark', extra: 'drop-me' },
          format: 'SINGLE',
          injected: 'drop-me',
        },
        publishStrategy: {
          schedule: 'SOON',
          scheduledTime: 'not-a-date',
          copywritingMode: 'SEQUENTIAL',
          extra: 'drop-me',
        },
      },
    })
    const res = resMock()

    await createDraft(req as any, res as any)

    const payload = mockBulkAdService.createDraft.mock.calls[0][0]
    expect(payload.accounts).toEqual([{
      accountId: 'act_123',
      pageId: 'page_1',
      conversionEvent: 'PURCHASE',
    }])
    expect(payload.campaign).toEqual({
      nameTemplate: 'camp',
      budget: 100_000_000,
      budgetOptimization: false,
      budgetType: 'DAILY',
      specialAdCategories: ['NONE'],
    })
    expect(payload.adset).toMatchObject({
      nameTemplate: 'adset',
      multiplier: 10,
      inlineTargeting: {
        geo_locations: { countries: ['US'] },
        nested: { safe: 'ok' },
      },
    })
    expect(payload.adset).not.toHaveProperty('targetingPackageId')
    expect(payload.adset.inlineTargeting).not.toHaveProperty('$where')
    expect(payload.adset.inlineTargeting).not.toHaveProperty('bad.key')
    expect(payload.ad).toEqual({
      nameTemplate: 'ad',
      format: 'SINGLE',
      tracking: { websiteEvent: true, urlTags: 'utm_source=autoark' },
      creativeGroupIds: [creativeGroupId],
      copywritingPackageIds: [copywritingPackageId],
    })
    expect(payload.publishStrategy).toEqual({ copywritingMode: 'SEQUENTIAL' })
  })

  it('sanitizes draft update payloads before saving', async () => {
    mockBulkAdService.updateDraft.mockResolvedValue({ _id: 'draft_1', name: 'Updated draft' } as any)
    const req = memberReq({
      body: {
        name: 'Updated draft',
        status: 'published',
        taskId: '665000000000000000000999',
        validation: { isValid: true },
        estimates: { totalAds: 999 },
        lastModifiedBy: 'attacker',
        accounts: [{ accountId: 'act_123' }],
      },
    })
    const res = resMock()

    await updateDraft(req as any, res as any)

    const payload = mockBulkAdService.updateDraft.mock.calls[0][1]
    expect(payload).toMatchObject({
      name: 'Updated draft',
      accounts: [{ accountId: 'act_123' }],
    })
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('taskId')
    expect(payload).not.toHaveProperty('validation')
    expect(payload).not.toHaveProperty('estimates')
    expect(payload).not.toHaveProperty('lastModifiedBy')
    expect(mockBulkAdService.updateDraft.mock.calls[0][0]).toBe(req.params.id)
    expectMemberControlFilter(mockBulkAdService.updateDraft.mock.calls[0][3])
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'draft_1', name: 'Updated draft' } })
  })

  it('sanitizes targeting interest search parameters before calling Meta', async () => {
    const sort = jest.fn().mockResolvedValue({ token: 'facebook-token' })
    jest.spyOn(FbToken, 'findOne').mockReturnValue({ sort } as any)
    mockFacebookClient.get.mockResolvedValue({
      data: [{ id: 'interest_1', name: 'Running shoes' }],
    } as any)

    const res = resMock()

    await searchInterests(memberReq({
      query: {
        q: '  running shoes  ',
        type: 'unsafe_type',
        limit: '9999',
      },
    }) as any, res as any)

    expect(FbToken.findOne).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      userId: '665000000000000000000002',
    }))
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 })
    expect(mockFacebookClient.get).toHaveBeenCalledWith('/search', {
      access_token: 'facebook-token',
      type: 'adinterest',
      q: 'running shoes',
      limit: 100,
    })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'interest_1', name: 'Running shoes' }],
    })
  })

  it('rejects invalid targeting location queries before loading a token', async () => {
    const findOne = jest.spyOn(FbToken, 'findOne')
    const res = resMock()

    await searchLocations(memberReq({
      query: {
        q: { $ne: 'US' },
        type: 'unsafe_type',
        limit: '9999',
      },
    }) as any, res as any)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'q parameter is required',
    })
    expect(findOne).not.toHaveBeenCalled()
    expect(mockFacebookClient.get).not.toHaveBeenCalled()
  })

  it('rejects malformed instagram page IDs before loading a token', async () => {
    const findOne = jest.spyOn(FbToken, 'findOne')
    const res = resMock()

    await getFacebookInstagramAccounts(memberReq({
      query: {
        pageId: { $ne: 'page_1' },
      },
    }) as any, res as any)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'pageId is required',
    })
    expect(findOne).not.toHaveBeenCalled()
    expect(mockFacebookClient.get).not.toHaveBeenCalled()
  })

  it('rejects unsafe instagram page ID paths before loading a token', async () => {
    const findOne = jest.spyOn(FbToken, 'findOne')
    const res = resMock()

    await getFacebookInstagramAccounts(memberReq({
      query: {
        pageId: 'page_1/instagram_accounts',
      },
    }) as any, res as any)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'pageId is required',
    })
    expect(findOne).not.toHaveBeenCalled()
    expect(mockFacebookClient.get).not.toHaveBeenCalled()
  })

  it('sanitizes instagram page IDs before calling Meta', async () => {
    const sort = jest.fn().mockResolvedValue({ token: 'facebook-token' })
    jest.spyOn(FbToken, 'findOne').mockReturnValue({ sort } as any)
    mockFacebookClient.get.mockResolvedValue({
      data: [{ id: 'ig_1', username: 'autoark' }],
    } as any)
    const res = resMock()

    await getFacebookInstagramAccounts(memberReq({
      query: {
        pageId: '  page_1  ',
      },
    }) as any, res as any)

    expect(FbToken.findOne).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      userId: '665000000000000000000002',
    }))
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 })
    expect(mockFacebookClient.get).toHaveBeenCalledWith('/page_1/instagram_accounts', {
      access_token: 'facebook-token',
      fields: 'id,username,profile_pic',
    })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'ig_1', username: 'autoark' }],
    })
  })

  it('rejects bulk ad OAuth callbacks that are missing signed state', async () => {
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      query: { code: 'oauth-code' },
    }
    const res: any = {
      redirect: jest.fn(),
    }

    await handleAuthCallback(req, res)

    expect(mockOauthService.handleOAuthCallback).not.toHaveBeenCalled()
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      action: 'bulk_ad.facebook_oauth_callback',
      status: 'failed',
      reason: 'Invalid OAuth state',
      metadata: expect.objectContaining({
        stateParseError: 'Missing OAuth state',
      }),
    }))
    expect(res.redirect).toHaveBeenCalledWith('/oauth/callback?oauth_error=Invalid OAuth state')
  })

  it('sanitizes Facebook OAuth callback error parameters before auditing', async () => {
    mockWriteAuditLog.mockResolvedValue(undefined)
    const longDescription = 'x'.repeat(1500)

    const req: any = {
      query: {
        error: ' OAuthException ',
        error_description: ` ${longDescription} `,
        state: { $ne: 'signed-state' },
      },
    }
    const res: any = {
      redirect: jest.fn(),
    }

    await handleAuthCallback(req, res)

    expect(mockOauthService.handleOAuthCallback).not.toHaveBeenCalled()
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      action: 'bulk_ad.facebook_oauth_callback',
      status: 'failed',
      reason: 'x'.repeat(1000),
      metadata: expect.objectContaining({
        facebookError: 'OAuthException',
        facebookErrorDescription: 'x'.repeat(1000),
      }),
    }))
    expect(res.redirect).toHaveBeenCalledWith(`/oauth/callback?oauth_error=${encodeURIComponent('x'.repeat(1000))}`)
  })

  it('rejects signed bulk ad OAuth callbacks without a bulk-ad state payload', async () => {
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockOauthService.parseStateParamWithOptions.mockReturnValue({
      originalState: 'fb-token|665000000000000000000002',
    } as any)

    const req: any = {
      query: { code: 'oauth-code', state: 'signed-state' },
    }
    const res: any = {
      redirect: jest.fn(),
    }

    await handleAuthCallback(req, res)

    expect(mockOauthService.parseStateParamWithOptions).toHaveBeenCalledWith('signed-state', { requireSignature: true })
    expect(mockOauthService.handleOAuthCallback).not.toHaveBeenCalled()
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      action: 'bulk_ad.facebook_oauth_callback',
      status: 'failed',
      reason: 'Invalid OAuth state',
    }))
    expect(res.redirect).toHaveBeenCalledWith('/oauth/callback?oauth_error=Invalid OAuth state')
  })

  it('keeps user scope and audits background asset sync failures after OAuth success', async () => {
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockOauthService.parseStateParamWithOptions.mockReturnValue({
      originalState: 'bulk-ad|665000000000000000000002|665000000000000000000001',
    } as any)
    mockOauthService.handleOAuthCallback.mockResolvedValue({
      tokenId: '665000000000000000000901',
      fbUserId: 'fb_1',
      fbUserName: 'FB User',
      accessToken: 'EAA123456789012345678901234567890',
    } as any)
    jest.spyOn(FbToken, 'findByIdAndUpdate').mockResolvedValue({} as any)
    mockFacebookUserService.syncFacebookUserAssets.mockRejectedValue(new Error('sync failed'))

    const req: any = {
      query: { code: 'oauth-code', state: 'signed-state' },
      get: jest.fn(),
    }
    const res: any = {
      redirect: jest.fn(),
    }

    await handleAuthCallback(req, res)
    await Promise.resolve()
    await Promise.resolve()

    expect(FbToken.findByIdAndUpdate).toHaveBeenCalledWith('665000000000000000000901', {
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    })
    expect(mockFacebookUserService.syncFacebookUserAssets).toHaveBeenCalledWith(
      'fb_1',
      'EAA123456789012345678901234567890',
      '665000000000000000000901',
      '665000000000000000000001',
      expect.any(Function),
    )
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'bulk_ad',
      action: 'bulk_ad.facebook_oauth_callback',
      status: 'success',
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }))
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'bulk_ad',
      action: 'bulk_ad.facebook_asset_sync',
      status: 'failed',
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
      reason: 'sync failed',
      metadata: expect.objectContaining({
        tokenId: '665000000000000000000901',
        fbUserId: 'fb_1',
      }),
    }))
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/oauth/callback?oauth_success=true'))
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('token_id=665000000000000000000901'))
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('fb_user_id=fb_1'))
  })

  it('imports cached accounts into account management immediately after OAuth asset sync', async () => {
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockOauthService.parseStateParamWithOptions.mockReturnValue({
      originalState: 'bulk-ad|665000000000000000000002|665000000000000000000001',
    } as any)
    mockOauthService.handleOAuthCallback.mockResolvedValue({
      tokenId: '665000000000000000000901',
      fbUserId: 'fb_1',
      fbUserName: 'FB User',
      accessToken: 'EAA123456789012345678901234567890',
    } as any)
    jest.spyOn(FbToken, 'findByIdAndUpdate').mockResolvedValue({} as any)
    mockFacebookUserService.syncFacebookUserAssets.mockImplementation(async (...args: any[]) => {
      await args[4]([{ accountId: '123', name: 'Cached Account 123', status: 1 }])
      return { adAccounts: [] } as any
    })
    mockFacebookAccountsService.syncCachedAccountsForToken.mockResolvedValue({
      syncedCount: 1,
      skippedCount: 0,
    } as any)

    const req: any = {
      query: { code: 'oauth-code', state: 'signed-state' },
      get: jest.fn(),
    }
    const res: any = { redirect: jest.fn() }

    await handleAuthCallback(req, res)
    await Promise.resolve()
    await Promise.resolve()

    expect(mockFacebookAccountsService.syncCachedAccountsForToken).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: '665000000000000000000901',
        token: 'EAA123456789012345678901234567890',
        organizationId: '665000000000000000000001',
      }),
      [expect.objectContaining({ accountId: '123' })],
    )
    expect(FbToken.findByIdAndUpdate).toHaveBeenCalledWith(
      '665000000000000000000901',
      { lastAccountSyncedAt: expect.any(Date) },
    )
  })

  it('paginates and deduplicates authorized ad accounts across Meta pages', async () => {
    jest.spyOn(FbToken, 'find').mockReturnValue({
      sort: jest.fn().mockResolvedValue([
        { token: 'TOKEN_A', fbUserName: 'Operator A' },
      ]),
    } as any)
    mockFacebookClient.get
      .mockResolvedValueOnce({
        data: [
          { id: 'act_100', account_id: '100', name: 'Account 100', account_status: 1 },
        ],
        paging: { next: 'https://graph.facebook.com/next', cursors: { after: 'cursor_1' } },
      } as any)
      .mockResolvedValueOnce({
        data: [
          { id: 'act_100', account_id: '100', name: 'Account 100 duplicate', account_status: 1 },
          { id: 'act_101', account_id: '101', name: 'Account 101', account_status: 1 },
        ],
      } as any)

    const req: any = {
      user: {
        role: UserRole.SUPER_ADMIN,
        userId: '665000000000000000000002',
      },
      query: {},
    }
    const res = resMock()

    await getAuthAdAccounts(req, res as any)

    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(1, '/me/adaccounts', {
      access_token: 'TOKEN_A',
      fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance',
      limit: 100,
    })
    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(2, '/me/adaccounts', {
      access_token: 'TOKEN_A',
      fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance',
      limit: 100,
      after: 'cursor_1',
    })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({ account_id: '100', name: 'Account 100', _tokenOwner: 'Operator A' }),
        expect.objectContaining({ account_id: '101', name: 'Account 101', _tokenOwner: 'Operator A' }),
      ],
      meta: expect.objectContaining({
        tokenCount: 1,
        failedTokenCount: 0,
        accountCount: 2,
        sourceAccountCount: 2,
        fetchedPageCount: 2,
        pageLimitPerToken: 10,
        paginationTruncated: false,
      }),
    })
  })

  it('serves cached authorized ad accounts without another Meta Graph read', async () => {
    jest.spyOn(FbToken, 'find').mockReturnValue({
      sort: jest.fn().mockResolvedValue([{
        _id: '665000000000000000000901',
        token: 'TOKEN_A',
        fbUserId: 'fb_1',
        fbUserName: 'Operator A',
        organizationId: '665000000000000000000001',
      }]),
    } as any)
    mockFacebookUserService.getCachedAccountsWithMeta.mockResolvedValue({
      accounts: [{
        accountId: '100',
        name: 'Cached Account 100',
        status: 1,
        currency: 'USD',
        timezone: 'America/Los_Angeles',
      }],
      fetchedPageCount: 10,
      paginationTruncated: true,
    } as any)

    const req: any = {
      user: {
        role: UserRole.SUPER_ADMIN,
        userId: '665000000000000000000002',
      },
      query: {},
    }
    const res = resMock()

    await getAuthAdAccounts(req, res as any)

    expect(mockFacebookUserService.getCachedAccountsWithMeta).toHaveBeenCalledWith('fb_1', {
      tokenId: '665000000000000000000901',
      organizationId: '665000000000000000000001',
    })
    expect(mockFacebookClient.get).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [expect.objectContaining({
        id: 'act_100',
        account_id: '100',
        name: 'Cached Account 100',
        account_status: 1,
      })],
      meta: expect.objectContaining({
        accountCount: 1,
        cacheTokenCount: 1,
        liveTokenCount: 0,
        fetchedPageCount: 10,
        paginationTruncated: true,
      }),
    })
  })

  it('marks authorized ad account pagination as truncated at the page cap', async () => {
    jest.spyOn(FbToken, 'find').mockReturnValue({
      sort: jest.fn().mockResolvedValue([
        { token: 'TOKEN_A', fbUserName: 'Operator A' },
      ]),
    } as any)
    mockFacebookClient.get.mockImplementation(async (_path: string, params: any) => ({
      data: [{ id: `act_${params.after || 'first'}`, account_id: params.after || 'first', name: 'Account' }],
      paging: { next: 'https://graph.facebook.com/next', cursors: { after: `cursor_${mockFacebookClient.get.mock.calls.length}` } },
    }))

    const req: any = {
      user: {
        role: UserRole.SUPER_ADMIN,
        userId: '665000000000000000000002',
      },
      query: {},
    }
    const res = resMock()

    await getAuthAdAccounts(req, res as any)

    expect(mockFacebookClient.get).toHaveBeenCalledTimes(10)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.any(Array),
      meta: expect.objectContaining({
        accountCount: 10,
        fetchedPageCount: 10,
        pageLimitPerToken: 10,
        paginationTruncated: true,
      }),
    })
  })

  it('paginates and deduplicates promote pages for an authorized ad account', async () => {
    jest.spyOn(FbToken, 'find').mockResolvedValue([
      { token: 'TOKEN_A', fbUserName: 'Operator A', fbUserId: 'fb_user_1' },
    ] as any)
    mockFacebookClient.get
      .mockResolvedValueOnce({ id: 'act_123', name: 'Account 123' } as any)
      .mockResolvedValueOnce({
        data: [
          { id: 'page_1', name: 'Page 1', access_token: 'PAGE_TOKEN' },
        ],
        paging: { next: 'https://graph.facebook.com/next', cursors: { after: 'cursor_1' } },
      } as any)
      .mockResolvedValueOnce({
        data: [
          { id: 'page_1', name: 'Page 1 duplicate', access_token: 'PAGE_TOKEN' },
          { id: 'page_2', name: 'Page 2' },
        ],
      } as any)

    const req: any = {
      query: { accountId: 'act_123' },
      user: {
        role: UserRole.SUPER_ADMIN,
        userId: '665000000000000000000002',
      },
    }
    const res = resMock()

    await getAuthPages(req, res as any)

    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(1, '/act_123', {
      access_token: 'TOKEN_A',
      fields: 'id,name',
    })
    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(2, '/act_123/promote_pages', {
      access_token: 'TOKEN_A',
      fields: 'id,name,picture',
      limit: 100,
    })
    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(3, '/act_123/promote_pages', {
      access_token: 'TOKEN_A',
      fields: 'id,name,picture',
      limit: 100,
      after: 'cursor_1',
    })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({ id: 'page_1', name: 'Page 1' }),
        expect.objectContaining({ id: 'page_2', name: 'Page 2' }),
      ],
      meta: expect.objectContaining({
        source: 'promote_pages',
        pageCount: 2,
        fetchedPageCount: 2,
        pageLimit: 10,
        paginationTruncated: false,
        promotePagesFailed: false,
      }),
    })
    expect((res.json as jest.Mock).mock.calls[0][0].data[0]).not.toHaveProperty('access_token')
  })

  it('falls back to paginated user pages when promote pages cannot be read', async () => {
    jest.spyOn(FbToken, 'find').mockResolvedValue([
      { token: 'TOKEN_A', fbUserName: 'Operator A', fbUserId: 'fb_user_1' },
    ] as any)
    mockFacebookClient.get
      .mockResolvedValueOnce({ id: 'act_123', name: 'Account 123' } as any)
      .mockRejectedValueOnce(new Error('promote_pages permission denied'))
      .mockResolvedValueOnce({
        data: [{ id: 'page_fallback', name: 'Fallback Page' }],
      } as any)

    const req: any = {
      query: { accountId: 'act_123' },
      user: {
        role: UserRole.SUPER_ADMIN,
        userId: '665000000000000000000002',
      },
    }
    const res = resMock()

    await getAuthPages(req, res as any)

    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(3, '/fb_user_1/accounts', {
      access_token: 'TOKEN_A',
      fields: 'id,name,picture',
      limit: 100,
    })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [expect.objectContaining({ id: 'page_fallback', name: 'Fallback Page' })],
      meta: expect.objectContaining({
        source: 'user_pages',
        pageCount: 1,
        fetchedPageCount: 1,
        paginationTruncated: false,
        promotePagesFailed: true,
      }),
    })
  })

  it('writes an audit log when a task support package is generated', async () => {
    const supportPackage = {
      supportId: 'AUTOARK-TASK-20260601170000-000401',
      system: {
        build: {
          ref: 'feat/commercial-saas-foundation',
          commit: '1234567890abcdef',
          shortCommit: '1234567890ab',
          deployedAt: '2026-06-01T12:00:00Z',
        },
      },
      task: {
        id: '665000000000000000000401',
        name: 'autoark_demo_task',
        status: 'failed',
      },
      diagnostics: {
        health: 'blocked',
        summary: {
          totalErrors: 2,
          retryableErrors: 0,
          blockedErrors: 2,
          failedAccounts: 1,
        },
        buckets: [{ errorCode: 'PIXEL_ACCESS_REQUIRED' }],
      },
      failedItems: [{ accountId: 'act_123' }],
    }
    mockBulkAdService.getTaskSupportPackage.mockResolvedValue(supportPackage as any)
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      params: { id: '665000000000000000000401' },
      user: {
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await getTaskSupportPackage(req, res)

    expect(mockBulkAdService.getTaskSupportPackage).toHaveBeenCalledTimes(1)
    expect(mockBulkAdService.getTaskSupportPackage.mock.calls[0][0]).toBe('665000000000000000000401')
    expect(String((mockBulkAdService.getTaskSupportPackage.mock.calls[0][1] as any).organizationId))
      .toBe('665000000000000000000001')
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'bulk_ad',
      action: 'bulk_ad.task_support_package.generate',
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
      targetType: 'ad_task',
      targetId: '665000000000000000000401',
      summary: '生成任务排障包：autoark_demo_task',
      metadata: expect.objectContaining({
        supportId: 'AUTOARK-TASK-20260601170000-000401',
        taskStatus: 'failed',
        health: 'blocked',
        buildRef: 'feat/commercial-saas-foundation',
        buildCommit: '1234567890abcdef',
        buildShortCommit: '1234567890ab',
        buildDeployedAt: '2026-06-01T12:00:00Z',
        totalErrors: 2,
        blockedErrors: 2,
        failedAccounts: 1,
        failedItemCount: 1,
        topErrorCode: 'PIXEL_ACCESS_REQUIRED',
      }),
    }))
    expect(res.json).toHaveBeenCalledWith({ success: true, data: supportPackage })
  })

  it('writes a failed audit log when task support package generation fails', async () => {
    mockBulkAdService.getTaskSupportPackage.mockRejectedValue(new Error('Task not found'))
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      params: { id: '665000000000000000000401' },
      user: {
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await getTaskSupportPackage(req, res)

    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'bulk_ad',
      action: 'bulk_ad.task_support_package.generate',
      status: 'failed',
      targetType: 'ad_task',
      targetId: '665000000000000000000401',
      summary: '生成任务排障包失败',
      reason: 'Task not found',
    }))
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Task not found' })
  })

  it('preserves commercial quota diagnostics when rerun is blocked', async () => {
    const error: any = new Error('当前已有 3 个任务在执行，超过当前套餐并发额度 3。')
    error.code = 'MAX_CONCURRENT_TASKS_REACHED'
    error.statusCode = 429
    error.details = {
      runningTaskCount: 3,
      requestedTasks: 2,
      limit: 3,
      plan: 'starter',
    }
    mockBulkAdService.rerunTask.mockRejectedValue(error)
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      params: { id: '665000000000000000000401' },
      body: { multiplier: 2 },
      user: {
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await rerunTask(req, res)

    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'bulk_ad',
      action: 'bulk_ad.rerun',
      status: 'failed',
      targetType: 'ad_task',
      targetId: '665000000000000000000401',
      metadata: expect.objectContaining({
        multiplier: 2,
        errorCode: 'MAX_CONCURRENT_TASKS_REACHED',
        details: error.details,
      }),
    }))
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: error.message,
      errorCode: 'MAX_CONCURRENT_TASKS_REACHED',
      details: error.details,
    })
  })

  it('limits member draft publishing to their own organization task assets', async () => {
    mockBulkAdService.publishDraft.mockResolvedValue({
      _id: '665000000000000000000501',
      name: 'member_task',
      status: 'pending',
    } as any)
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      params: { id: '665000000000000000000010' },
      user: {
        role: UserRole.MEMBER,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await publishDraftController(req, res)

    const accessFilter = mockBulkAdService.publishDraft.mock.calls[0][2] as any
    expect(String(accessFilter.$and[0].organizationId)).toBe('665000000000000000000001')
    expect(accessFilter.$and[1].createdBy.$in.map(String)).toEqual(expect.arrayContaining([
      '665000000000000000000002',
    ]))
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ name: 'member_task' }),
    })
  })

  it('limits member task reruns to their own organization tasks', async () => {
    mockBulkAdService.rerunTask.mockResolvedValue([{
      _id: '665000000000000000000502',
      name: 'member_rerun',
    }] as any)
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      params: { id: '665000000000000000000401' },
      body: { multiplier: 1 },
      user: {
        role: UserRole.MEMBER,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await rerunTask(req, res)

    const accessFilter = mockBulkAdService.rerunTask.mock.calls[0][3] as any
    expect(String(accessFilter.$and[0].organizationId)).toBe('665000000000000000000001')
    expect(accessFilter.$and[1].createdBy.$in.map(String)).toEqual(expect.arrayContaining([
      '665000000000000000000002',
    ]))
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [expect.objectContaining({ name: 'member_rerun' })],
    })
  })

  it('limits member targeting package writes to their own assets', async () => {
    jest.spyOn(TargetingPackage, 'findOneAndUpdate').mockResolvedValue({
      _id: '665000000000000000000601',
      name: 'own targeting',
    } as any)
    jest.spyOn(TargetingPackage, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as any)
    const req = memberReq({ body: { name: 'updated targeting', createdBy: 'other' } })
    const res = resMock()

    await updateTargetingPackage(req as any, res as any)
    await deleteTargetingPackage(req as any, res as any)

    expectMemberControlFilter((TargetingPackage.findOneAndUpdate as jest.Mock).mock.calls[0][0], req.params.id)
    expect((TargetingPackage.findOneAndUpdate as jest.Mock).mock.calls[0][1]).not.toHaveProperty('createdBy')
    expectMemberControlFilter((TargetingPackage.deleteOne as jest.Mock).mock.calls[0][0], req.params.id)
  })

  it('sanitizes targeting package list filters before querying', async () => {
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    jest.spyOn(TargetingPackage, 'find').mockReturnValue(findQuery as any)
    jest.spyOn(TargetingPackage, 'countDocuments').mockResolvedValue(0 as any)
    const req = memberReq({
      query: {
        accountId: ' act_123 ',
        platform: { $ne: 'facebook' },
        pageSize: '9999',
      },
    })
    const res = resMock()

    await getTargetingPackageList(req as any, res as any)

    const filter = (TargetingPackage.find as jest.Mock).mock.calls[0][0]
    expect(String(filter.organizationId)).toBe('665000000000000000000001')
    expect(filter.accountId).toEqual({ $in: ['123', 'act_123'] })
    expect(filter).not.toHaveProperty('platform')
    expect(findQuery.limit).toHaveBeenCalledWith(100)
    expect(TargetingPackage.countDocuments).toHaveBeenCalledWith(filter)
  })

  it('sanitizes copywriting and creative package list platform filters', async () => {
    const copyFindQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    const creativeFindQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    jest.spyOn(CopywritingPackage, 'find').mockReturnValue(copyFindQuery as any)
    jest.spyOn(CopywritingPackage, 'countDocuments').mockResolvedValue(0 as any)
    jest.spyOn(CreativeGroup, 'find').mockReturnValue(creativeFindQuery as any)
    jest.spyOn(CreativeGroup, 'countDocuments').mockResolvedValue(0 as any)
    const res = resMock()

    await getCopywritingPackageList(memberReq({
      query: { accountId: { $ne: 'act_123' }, platform: 'tiktok' },
    }) as any, res as any)
    await getCreativeGroupList(memberReq({
      query: { accountId: 'act_456', platform: 'unsafe' },
    }) as any, res as any)

    expect((CopywritingPackage.find as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({
      platform: 'tiktok',
    }))
    expect((CopywritingPackage.find as jest.Mock).mock.calls[0][0]).not.toHaveProperty('accountId')
    expect((CreativeGroup.find as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({
      accountId: { $in: ['456', 'act_456'] },
    }))
    expect((CreativeGroup.find as jest.Mock).mock.calls[0][0]).not.toHaveProperty('platform')
  })

  it('sanitizes targeting package creation payloads', async () => {
    let savedPackage: any
    jest.spyOn(TargetingPackage.prototype as any, 'save').mockImplementation(function saveMock(this: any) {
      savedPackage = this
      return Promise.resolve(this)
    })
    const req = memberReq({
      body: {
        name: '  SEA broad targeting  ',
        organizationId: '665000000000000000000099',
        createdBy: 'attacker',
        savedToFacebook: true,
        facebookSavedAudienceId: 'audience_1',
        platform: 'facebook',
        geoLocations: {
          countries: ['US', 'US', { $ne: 'CN' }],
          cities: [{ key: 'city_1', name: 'Bangkok', radius: 120 }],
        },
        demographics: {
          ageMin: 10,
          ageMax: 70,
          genders: [1, 3, 2],
        },
        interests: [{ id: '6001', name: 'Games', audienceSize: '12345', extra: 'drop' }],
        placement: {
          type: 'manual',
          platforms: ['facebook', 'bad_platform'],
          devicePlatforms: ['mobile', 'desktop', 'tv'],
        },
        deviceSettings: {
          mobileOS: ['Android', 'bad'],
          mobileDevices: ['android_smartphone', 'bad_device'],
          wifiOnly: true,
        },
        optimizationGoal: 'LINK_CLICKS',
        tags: ['growth', 'growth', { $ne: 'x' }],
      },
    })
    const res = resMock()

    await createTargetingPackage(req as any, res as any)

    expect(savedPackage.name).toBe('SEA broad targeting')
    expect(String(savedPackage.organizationId)).toBe('665000000000000000000001')
    expect(savedPackage.createdBy).toBe('665000000000000000000002')
    expect(savedPackage.savedToFacebook).toBe(false)
    expect(savedPackage.facebookSavedAudienceId).toBeUndefined()
    expect(savedPackage.geoLocations.countries).toEqual(['US'])
    expect(savedPackage.demographics.ageMin).toBe(13)
    expect(savedPackage.demographics.ageMax).toBe(65)
    expect(savedPackage.demographics.genders).toEqual([1, 2])
    expect(savedPackage.interests[0].toObject()).toMatchObject({ id: '6001', name: 'Games', audienceSize: 12345 })
    expect(savedPackage.interests[0].toObject()).not.toHaveProperty('extra')
    expect(savedPackage.placement.platforms).toEqual(['facebook'])
    expect(savedPackage.placement.devicePlatforms).toEqual(['mobile', 'desktop'])
    expect(savedPackage.deviceSettings.mobileOS).toEqual(['Android'])
    expect(savedPackage.deviceSettings.mobileDevices).toEqual(['android_smartphone'])
    expect(savedPackage.deviceSettings.wifiOnly).toBe(true)
    expect(savedPackage.optimizationGoal).toBe('LINK_CLICKS')
    expect(savedPackage.tags).toEqual(['growth'])
    expect(res.json).toHaveBeenCalledWith({ success: true, data: savedPackage })
  })

  it('limits member copywriting package writes and product parsing to their own assets', async () => {
    jest.spyOn(CopywritingPackage, 'findOneAndUpdate').mockResolvedValue({
      _id: '665000000000000000000601',
      name: 'own copy',
    } as any)
    jest.spyOn(CopywritingPackage, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as any)
    jest.spyOn(CopywritingPackage, 'find').mockResolvedValue([] as any)
    const req = memberReq({ body: { name: 'updated copy', organizationId: 'other' } })
    const res = resMock()

    await updateCopywritingPackage(req as any, res as any)
    await deleteCopywritingPackage(req as any, res as any)
    await parseAllCopywritingProducts(memberReq() as any, res as any)

    expectMemberControlFilter((CopywritingPackage.findOneAndUpdate as jest.Mock).mock.calls[0][0], req.params.id)
    expect((CopywritingPackage.findOneAndUpdate as jest.Mock).mock.calls[0][1]).not.toHaveProperty('organizationId')
    expectMemberControlFilter((CopywritingPackage.deleteOne as jest.Mock).mock.calls[0][0], req.params.id)

    const parseFilter = (CopywritingPackage.find as jest.Mock).mock.calls[0][0]
    expectMemberControlFilter(parseFilter.$and[0])
    expect(parseFilter.$and[1]).toEqual(expect.objectContaining({
      'links.websiteUrl': { $exists: true, $ne: '' },
    }))
  })

  it('sanitizes copywriting package creation payloads', async () => {
    let savedPackage: any
    jest.spyOn(CopywritingPackage.prototype as any, 'save').mockImplementation(function saveMock(this: any) {
      savedPackage = this
      return Promise.resolve(this)
    })
    const req = memberReq({
      body: {
        name: '  Product ad copy  ',
        organizationId: '665000000000000000000099',
        createdBy: 'attacker',
        usageCount: 999,
        lastUsedAt: '2026-01-01T00:00:00.000Z',
        content: {
          primaryTexts: ['  hello buyers  ', { $ne: 'x' }],
          headlines: ['  Big launch  '],
          descriptions: ['  Try today  '],
        },
        callToAction: 'DOWNLOAD',
        links: {
          websiteUrl: '  https://example.com/app?utm=1  ',
          displayLink: '  example.com  ',
          unsafe: 'drop',
        },
        product: {
          name: 'Manual product',
          autoExtracted: false,
          extra: 'drop',
        },
        urlParameters: {
          utmSource: 'autoark',
          customParams: {
            creative: 'hero',
            ignored: { $ne: 'x' },
          },
        },
        language: 'zh-CN',
        tags: ['copy', 'copy', { $ne: 'x' }],
      },
    })
    const res = resMock()

    await createCopywritingPackage(req as any, res as any)

    expect(savedPackage.name).toBe('Product ad copy')
    expect(String(savedPackage.organizationId)).toBe('665000000000000000000001')
    expect(savedPackage.createdBy).toBe('665000000000000000000002')
    expect(savedPackage.usageCount).toBe(0)
    expect(savedPackage.lastUsedAt).toBeUndefined()
    expect(savedPackage.content.primaryTexts).toEqual(['hello buyers'])
    expect(savedPackage.content.headlines).toEqual(['Big launch'])
    expect(savedPackage.callToAction).toBe('DOWNLOAD')
    expect(savedPackage.links.websiteUrl).toBe('https://example.com/app?utm=1')
    expect(savedPackage.links.displayLink).toBe('example.com')
    expect(savedPackage.product.name).toBe('Manual product')
    expect(savedPackage.product.autoExtracted).toBe(false)
    expect(savedPackage.product.toObject()).not.toHaveProperty('extra')
    expect(savedPackage.urlParameters.utmSource).toBe('autoark')
    expect(savedPackage.urlParameters.customParams.get('creative')).toBe('hero')
    expect(savedPackage.urlParameters.customParams.has('ignored')).toBe(false)
    expect(savedPackage.language).toBe('zh-CN')
    expect(savedPackage.tags).toEqual(['copy'])
    expect(res.json).toHaveBeenCalledWith({ success: true, data: savedPackage })
  })

  it('limits member creative group writes to their own assets', async () => {
    const group: any = {
      _id: '665000000000000000000601',
      name: 'own creative',
      materials: [{ _id: { toString: () => 'mat_1' }, type: 'image', url: 'https://cdn.test/a.jpg' }],
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(CreativeGroup, 'findOneAndUpdate').mockResolvedValue(group)
    jest.spyOn(CreativeGroup, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as any)
    jest.spyOn(CreativeGroup, 'findOne').mockResolvedValue(group)
    const req = memberReq({
      body: { _id: { toString: () => 'mat_2' }, name: 'updated creative', userId: 'other', type: 'image', url: 'https://cdn.test/b.jpg' },
      params: { materialId: 'mat_1' },
    })
    const res = resMock()

    await updateCreativeGroup(req as any, res as any)
    await deleteCreativeGroup(req as any, res as any)
    await removeMaterial(req as any, res as any)
    await addMaterial(req as any, res as any)

    expectMemberControlFilter((CreativeGroup.findOneAndUpdate as jest.Mock).mock.calls[0][0], req.params.id)
    expect((CreativeGroup.findOneAndUpdate as jest.Mock).mock.calls[0][1]).not.toHaveProperty('userId')
    expectMemberControlFilter((CreativeGroup.deleteOne as jest.Mock).mock.calls[0][0], req.params.id)
    expectMemberControlFilter((CreativeGroup.findOne as jest.Mock).mock.calls[0][0], req.params.id)
    expectMemberControlFilter((CreativeGroup.findOne as jest.Mock).mock.calls[1][0], req.params.id)
    const addedMaterial = group.materials[group.materials.length - 1]
    expect(addedMaterial).toMatchObject({
      type: 'image',
      url: 'https://cdn.test/b.jpg',
      name: 'updated creative',
    })
    expect(addedMaterial).not.toHaveProperty('_id')
    expect(addedMaterial).not.toHaveProperty('userId')
  })

  it('sanitizes creative group creation payloads', async () => {
    let savedGroup: any
    jest.spyOn(CreativeGroup.prototype as any, 'save').mockImplementation(function saveMock(this: any) {
      savedGroup = this
      return Promise.resolve(this)
    })

    const maliciousMaterialId = '665000000000000000000777'
    const req = memberReq({
      body: {
        name: '  Product launch creative  ',
        organizationId: '665000000000000000000099',
        createdBy: 'attacker',
        usageCount: 999,
        materialStats: { totalCount: 999 },
        platform: 'facebook',
        accountId: 'act_123',
        description: '  launch assets  ',
        tags: ['hero', 'hero', '  video  ', { $ne: 'x' }],
        config: {
          format: 'carousel',
          dynamicCreative: true,
          carousel: {
            autoOptimize: false,
            linkPerCard: true,
            extra: 'drop',
          },
          extra: 'drop',
        },
        materials: [{
          _id: maliciousMaterialId,
          type: 'image',
          url: '  https://cdn.test/hero.jpg  ',
          name: '  hero  ',
          width: '1200.8',
          height: -1,
          status: 'uploaded',
          userId: 'attacker',
          unexpected: 'drop',
        }],
      },
    })
    const res = resMock()

    await createCreativeGroup(req as any, res as any)

    expect(savedGroup.name).toBe('Product launch creative')
    expect(String(savedGroup.organizationId)).toBe('665000000000000000000001')
    expect(savedGroup.createdBy).toBe('665000000000000000000002')
    expect(savedGroup.usageCount).toBe(0)
    expect(savedGroup.materialStats.totalCount).toBe(0)
    expect(savedGroup.tags).toEqual(['hero', 'video'])
    expect(savedGroup.config.format).toBe('carousel')
    expect(savedGroup.config.carousel.autoOptimize).toBe(false)
    expect(savedGroup.config.carousel.linkPerCard).toBe(true)

    const material = savedGroup.materials[0].toObject()
    expect(material).toMatchObject({
      type: 'image',
      url: 'https://cdn.test/hero.jpg',
      name: 'hero',
      width: 1200,
      status: 'uploaded',
    })
    expect(material._id.toString()).not.toBe(maliciousMaterialId)
    expect(material).not.toHaveProperty('userId')
    expect(material).not.toHaveProperty('unexpected')
    expect(res.json).toHaveBeenCalledWith({ success: true, data: savedGroup })
  })

  it('sanitizes creative group update payloads', async () => {
    jest.spyOn(CreativeGroup, 'findOneAndUpdate').mockResolvedValue({
      _id: '665000000000000000000601',
      name: 'Product launch creative',
    } as any)
    const req = memberReq({
      body: {
        name: '  Product launch creative  ',
        organizationId: '665000000000000000000099',
        createdBy: 'attacker',
        usageCount: 999,
        materialStats: { totalCount: 999 },
        platform: 'facebook',
        accountId: 'act_123',
        description: '  launch assets  ',
        tags: ['hero', 'hero', '  video  ', { $ne: 'x' }],
        config: {
          format: 'carousel',
          dynamicCreative: true,
          carousel: {
            autoOptimize: false,
            linkPerCard: true,
            extra: 'drop',
          },
          extra: 'drop',
        },
        materials: [{
          _id: '665000000000000000000777',
          type: 'image',
          url: '  https://cdn.test/hero.jpg  ',
          name: '  hero  ',
          width: '1200.8',
          height: -1,
          status: 'uploaded',
          userId: 'attacker',
          unexpected: 'drop',
        }],
      },
    })
    const res = resMock()

    await updateCreativeGroup(req as any, res as any)

    const payload = (CreativeGroup.findOneAndUpdate as jest.Mock).mock.calls[0][1]
    expect(payload).toMatchObject({
      name: 'Product launch creative',
      platform: 'facebook',
      accountId: '123',
      description: 'launch assets',
      tags: ['hero', 'video'],
      config: {
        format: 'carousel',
        dynamicCreative: true,
        carousel: {
          autoOptimize: false,
          linkPerCard: true,
        },
      },
      materials: [{
        type: 'image',
        url: 'https://cdn.test/hero.jpg',
        name: 'hero',
        width: 1200,
        status: 'uploaded',
      }],
    })
    expect(payload).not.toHaveProperty('organizationId')
    expect(payload).not.toHaveProperty('createdBy')
    expect(payload).not.toHaveProperty('usageCount')
    expect(payload).not.toHaveProperty('materialStats')
    expect(payload.materials[0]).not.toHaveProperty('_id')
    expect(payload.materials[0]).not.toHaveProperty('userId')
    expect(payload.materials[0]).not.toHaveProperty('unexpected')
  })

  it('rejects auth pixel reads for accounts outside the requester asset scope', async () => {
    jest.spyOn(Account, 'findOne').mockReturnValue(modelQuery(null) as any)
    const tokenFind = jest.spyOn(FbToken, 'find').mockResolvedValue([] as any)

    const req: any = {
      query: { accountId: 'act_123' },
      user: {
        role: UserRole.ORG_ADMIN,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await getAuthPixels(req, res)

    const accountQuery = (Account.findOne as jest.Mock).mock.calls[0][0]
    expect(accountQuery.$and[0]).toEqual({ channel: 'facebook', accountId: { $in: ['123', 'act_123'] } })
    expect(String(accountQuery.$and[1].organizationId)).toBe('665000000000000000000001')
    expect(tokenFind).not.toHaveBeenCalled()
    expect(mockFacebookClient.get).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '无权访问广告账户 123，请先同步并分配账户资产',
    })
  })

  it('rejects unsafe auth pixel account ID paths before loading tokens', async () => {
    const tokenFind = jest.spyOn(FbToken, 'find').mockResolvedValue([] as any)
    const res = resMock()

    await getAuthPixels({
      query: { accountId: 'act_123/adspixels' },
      user: {
        role: UserRole.SUPER_ADMIN,
        userId: '665000000000000000000002',
      },
    } as any, res as any)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'accountId is required',
    })
    expect(tokenFind).not.toHaveBeenCalled()
    expect(mockFacebookClient.get).not.toHaveBeenCalled()
  })

  it('uses the scoped token that can access the requested account when reading pixels', async () => {
    jest.spyOn(Account, 'findOne').mockReturnValue(modelQuery({
      _id: '665000000000000000000101',
      accountId: '123',
    }) as any)
    jest.spyOn(FbToken, 'find').mockResolvedValue([
      { _id: '665000000000000000000201', token: 'TOKEN_WITHOUT_ACCOUNT', fbUserName: 'token-a' },
      { _id: '665000000000000000000202', token: 'TOKEN_WITH_ACCOUNT', fbUserName: 'token-b' },
    ] as any)
    mockFacebookClient.get
      .mockRejectedValueOnce(new Error('Unsupported get request'))
      .mockResolvedValueOnce({ id: 'act_123', name: 'Account 123' } as any)
      .mockResolvedValueOnce({ data: [{ id: 'pixel_1', name: 'Pixel 1' }] } as any)

    const req: any = {
      query: { accountId: 'act_123' },
      user: {
        role: UserRole.ORG_ADMIN,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await getAuthPixels(req, res)

    const tokenQuery = (FbToken.find as jest.Mock).mock.calls[0][0]
    expect(tokenQuery.status).toBe('active')
    expect(String(tokenQuery.organizationId)).toBe('665000000000000000000001')
    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(1, '/act_123', {
      access_token: 'TOKEN_WITHOUT_ACCOUNT',
      fields: 'id,name',
    })
    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(2, '/act_123', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id,name',
    })
    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(3, '/act_123/adspixels', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id,name,code,last_fired_time',
      limit: 100,
    })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'pixel_1', name: 'Pixel 1' }],
      meta: expect.objectContaining({
        pixelCount: 1,
        fetchedPageCount: 1,
        pageLimit: 10,
        paginationTruncated: false,
      }),
    })
  })

  it('paginates auth pixel reads for large ad accounts', async () => {
    jest.spyOn(FbToken, 'find').mockResolvedValue([
      { _id: '665000000000000000000202', token: 'TOKEN_WITH_ACCOUNT', fbUserName: 'token-b' },
    ] as any)
    mockFacebookClient.get
      .mockResolvedValueOnce({ id: 'act_123', name: 'Account 123' } as any)
      .mockResolvedValueOnce({
        data: [{ id: 'pixel_1', name: 'Pixel 1' }],
        paging: { next: 'https://graph.facebook.com/next', cursors: { after: 'cursor_1' } },
      } as any)
      .mockResolvedValueOnce({
        data: [{ id: 'pixel_2', name: 'Pixel 2' }],
      } as any)

    const req: any = {
      query: { accountId: 'act_123' },
      user: {
        role: UserRole.SUPER_ADMIN,
        userId: '665000000000000000000002',
      },
    }
    const res = resMock()

    await getAuthPixels(req, res as any)

    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(2, '/act_123/adspixels', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id,name,code,last_fired_time',
      limit: 100,
    })
    expect(mockFacebookClient.get).toHaveBeenNthCalledWith(3, '/act_123/adspixels', {
      access_token: 'TOKEN_WITH_ACCOUNT',
      fields: 'id,name,code,last_fired_time',
      limit: 100,
      after: 'cursor_1',
    })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        { id: 'pixel_1', name: 'Pixel 1' },
        { id: 'pixel_2', name: 'Pixel 2' },
      ],
      meta: expect.objectContaining({
        pixelCount: 2,
        fetchedPageCount: 2,
        paginationTruncated: false,
      }),
    })
  })
})
