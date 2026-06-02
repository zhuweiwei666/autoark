jest.mock('../src/services/bulkAd.service', () => ({
  __esModule: true,
  default: {
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
  getCachedCatalogs: jest.fn(),
  getSyncStatus: jest.fn(),
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
  deleteCopywritingPackage,
  deleteCreativeGroup,
  deleteTargetingPackage,
  getAuthAdAccounts,
  getAuthPages,
  getAuthPixels,
  getAuthLoginUrl,
  handleAuthCallback,
  publishDraft as publishDraftController,
  parseAllCopywritingProducts,
  updateCopywritingPackage,
  updateCreativeGroup,
  updateTargetingPackage,
  getTaskSupportPackage,
  removeMaterial,
  rerunTask,
  validateDraft as validateDraftController,
} from '../src/controllers/bulkAd.controller'

const mockBulkAdService = bulkAdService as jest.Mocked<typeof bulkAdService>
const mockWriteAuditLog = writeAuditLog as jest.Mock
const mockOauthService = oauthService as jest.Mocked<typeof oauthService>
const mockFacebookUserService = facebookUserService as jest.Mocked<typeof facebookUserService>
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
    await addMaterial(req as any, res as any)
    await removeMaterial(req as any, res as any)

    expectMemberControlFilter((CreativeGroup.findOneAndUpdate as jest.Mock).mock.calls[0][0], req.params.id)
    expect((CreativeGroup.findOneAndUpdate as jest.Mock).mock.calls[0][1]).not.toHaveProperty('userId')
    expectMemberControlFilter((CreativeGroup.deleteOne as jest.Mock).mock.calls[0][0], req.params.id)
    expectMemberControlFilter((CreativeGroup.findOne as jest.Mock).mock.calls[0][0], req.params.id)
    expectMemberControlFilter((CreativeGroup.findOne as jest.Mock).mock.calls[1][0], req.params.id)
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
    })
  })
})
