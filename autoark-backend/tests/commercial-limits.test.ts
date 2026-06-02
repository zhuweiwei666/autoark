import Account from '../src/models/Account'
import AdTask from '../src/models/AdTask'
import AdDraft from '../src/models/AdDraft'
import FacebookApp from '../src/models/FacebookApp'
import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import Material from '../src/models/Material'
import OpsLog from '../src/models/OpsLog'
import Organization, {
  OrganizationBillingStatus,
  OrganizationPlan,
  OrganizationStatus,
} from '../src/models/Organization'
import User, { UserRole } from '../src/models/User'
import {
  assertBulkAdPublishAllowed,
  CommercialLimitError,
  getCommercialReadiness,
  getCommercialSupportPackage,
  getCommercialUsageLedger,
} from '../src/services/commercial.service'

const organizationId = '665000000000000000000001'

const mockOrganization = (overrides: any = {}) => ({
  _id: organizationId,
  status: OrganizationStatus.ACTIVE,
  billing: {
    plan: OrganizationPlan.STARTER,
    status: OrganizationBillingStatus.ACTIVE,
  },
  settings: {},
  ...overrides,
})

const originalBusinessLoginConfigId = process.env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID
const originalOauthStateSecret = process.env.OAUTH_STATE_SECRET
const originalDeployRef = process.env.AUTOARK_DEPLOY_REF
const originalDeployCommit = process.env.AUTOARK_DEPLOY_COMMIT
const originalDeployedAt = process.env.AUTOARK_DEPLOYED_AT

describe('commercial publish limits', () => {
  beforeEach(() => {
    process.env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID = 'test_business_login_config'
    process.env.OAUTH_STATE_SECRET = 'test_oauth_state_secret'
    process.env.AUTOARK_DEPLOY_REF = 'feat/commercial-saas-foundation'
    process.env.AUTOARK_DEPLOY_COMMIT = '1234567890abcdef'
    process.env.AUTOARK_DEPLOYED_AT = '2026-06-01T12:00:00Z'
  })

  afterEach(() => {
    jest.restoreAllMocks()
    for (const [key, value] of Object.entries({
      FACEBOOK_BUSINESS_LOGIN_CONFIG_ID: originalBusinessLoginConfigId,
      OAUTH_STATE_SECRET: originalOauthStateSecret,
      AUTOARK_DEPLOY_REF: originalDeployRef,
      AUTOARK_DEPLOY_COMMIT: originalDeployCommit,
      AUTOARK_DEPLOYED_AT: originalDeployedAt,
    })) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  const tokenFindResult = (tokens: any[]) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(tokens),
  })

  const leanFindResult = (items: any[]) => ({
    lean: jest.fn().mockResolvedValue(items),
  })

  const sortedLeanFindResult = (items: any[]) => ({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(items),
  })

  it('blocks organizations with inactive billing', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization({
      billing: {
        plan: OrganizationPlan.STARTER,
        status: OrganizationBillingStatus.PAUSED,
      },
    }) as any)

    await expect(assertBulkAdPublishAllowed({ organizationId, requestedAccounts: 1 }))
      .rejects.toMatchObject({
        code: 'BILLING_NOT_ACTIVE',
        statusCode: 402,
      } as CommercialLimitError)
  })

  it('blocks tasks selecting more accounts than the plan allows', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization({
      billing: {
        plan: OrganizationPlan.TRIAL,
        status: OrganizationBillingStatus.TRIALING,
      },
      settings: {},
    }) as any)

    await expect(assertBulkAdPublishAllowed({ organizationId, requestedAccounts: 4 }))
      .rejects.toMatchObject({
        code: 'TASK_ACCOUNT_LIMIT_EXCEEDED',
        statusCode: 403,
      } as CommercialLimitError)
  })

  it('caps oversized requested account counts before quota checks', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization({
      billing: {
        plan: OrganizationPlan.TRIAL,
        status: OrganizationBillingStatus.TRIALING,
      },
      settings: {},
    }) as any)

    await expect(assertBulkAdPublishAllowed({
      organizationId,
      requestedAccounts: 999999,
    })).rejects.toMatchObject({
      code: 'TASK_ACCOUNT_LIMIT_EXCEEDED',
      details: expect.objectContaining({
        requestedAccounts: 10000,
      }),
    } as CommercialLimitError)
  })

  it('blocks when concurrent task quota is reached', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization() as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(3 as any)
      .mockResolvedValueOnce(0 as any)

    await expect(assertBulkAdPublishAllowed({ organizationId, requestedAccounts: 1 }))
      .rejects.toMatchObject({
        code: 'MAX_CONCURRENT_TASKS_REACHED',
        statusCode: 429,
      } as CommercialLimitError)
  })

  it('falls back on non-finite requested counts before quota checks', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization() as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)

    const result = await assertBulkAdPublishAllowed({
      organizationId,
      requestedAccounts: Number.POSITIVE_INFINITY,
      requestedTasks: Number.POSITIVE_INFINITY,
    })

    expect(result.usage).toMatchObject({
      requestedAccounts: 1,
      requestedTasks: 1,
    })
  })

  it('blocks publish when bulk ad create feature is disabled by organization override', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization({
      settings: {
        features: ['facebook_oauth', 'material_library'],
      },
    }) as any)

    await expect(assertBulkAdPublishAllowed({ organizationId, requestedAccounts: 1 }))
      .rejects.toMatchObject({
        code: 'FEATURE_NOT_INCLUDED',
        statusCode: 403,
        details: expect.objectContaining({
          feature: 'bulk_ad_create',
          enabledFeatures: ['facebook_oauth', 'material_library'],
        }),
      } as CommercialLimitError)
  })

  it('allows publish when billing and usage are within quota', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization() as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(12 as any)

    const result = await assertBulkAdPublishAllowed({ organizationId, requestedAccounts: 2 })

    expect(result.allowed).toBe(true)
    expect(result.plan).toBe(OrganizationPlan.STARTER)
    expect(result.usage).toEqual({
      runningTaskCount: 1,
      monthlyTaskCount: 12,
      requestedAccounts: 2,
      requestedTasks: 1,
    })
  })

  it('blocks reruns when requested task multiplier would exceed concurrent quota', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization() as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(2 as any)
      .mockResolvedValueOnce(0 as any)

    await expect(assertBulkAdPublishAllowed({ organizationId, requestedAccounts: 2, requestedTasks: 2 }))
      .rejects.toMatchObject({
        code: 'MAX_CONCURRENT_TASKS_REACHED',
        statusCode: 429,
        details: expect.objectContaining({ requestedTasks: 2 }),
      } as CommercialLimitError)
  })

  it('caps oversized requested task counts before quota checks', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization() as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)

    await expect(assertBulkAdPublishAllowed({
      organizationId,
      requestedAccounts: 1,
      requestedTasks: 999999,
    })).rejects.toMatchObject({
      code: 'MAX_CONCURRENT_TASKS_REACHED',
      details: expect.objectContaining({
        requestedTasks: 10000,
      }),
    } as CommercialLimitError)
  })

  it('uses unlimited enterprise limits in platform readiness mode', async () => {
    jest.spyOn(User, 'countDocuments')
      .mockResolvedValueOnce(2 as any)
      .mockResolvedValueOnce(2 as any)
    jest.spyOn(Account, 'countDocuments').mockResolvedValue(3 as any)
    jest.spyOn(FbToken, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(Material, 'countDocuments').mockResolvedValue(10 as any)
    jest.spyOn(AdDraft, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(4 as any)
      .mockResolvedValueOnce(2 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(4 as any)
    jest.spyOn(AdTask, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: '665000000000000000000201',
        status: 'failed',
        items: [{
          accountId: 'act_1',
          accountName: 'Account 1',
          status: 'failed',
          errors: [{
            errorCode: 'PIXEL_ACCESS_REQUIRED',
            errorMessage: 'Pixel missing',
          }],
        }],
      }]),
    } as any)
    jest.spyOn(FacebookApp, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenFindResult([{
      _id: '665000000000000000000099',
      fbUserId: 'fb_1',
      fbUserName: 'Facebook User',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(leanFindResult([{
      fbUserId: 'fb_1',
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_1', name: 'Ready account', status: 1 }],
      pages: [{ pageId: 'page_1', name: 'Page 1', accounts: [{ accountId: 'act_1' }] }],
      pixels: [{ pixelId: 'pixel_1', name: 'Pixel 1', accounts: [{ accountId: 'act_1' }] }],
    }]) as any)

    const readiness = await getCommercialReadiness({
      userId: 'admin',
      role: UserRole.SUPER_ADMIN,
    } as any)

    expect(readiness.plan.code).toBe(OrganizationPlan.ENTERPRISE)
    expect(readiness.plan.limits.monthlyTaskLimit).toBeNull()
    expect(readiness.plan.limits.maxConcurrentTasks).toBeNull()
    expect(readiness.usage.monthlyTasks.limit).toBeNull()
    expect(readiness.usage.concurrentTasks.limit).toBeNull()
    expect(readiness.metrics.facebookReadyAccounts).toBe(1)
    expect(readiness.metrics.recentTaskIssueTypes).toBe(1)
    expect(readiness.checklist.find(item => item.id === 'facebook_ready_accounts')?.status).toBe('done')
    expect(readiness.state.level).toBe('attention')
    expect(readiness.risks.some(risk => risk.level === 'info')).toBe(true)
    expect(readiness.nextActions.some(action => action.id === 'review_recent_task_warnings')).toBe(true)
  })

  it('blocks commercial readiness when business login config is missing', async () => {
    delete process.env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID
    jest.spyOn(User, 'countDocuments')
      .mockResolvedValueOnce(2 as any)
      .mockResolvedValueOnce(2 as any)
    jest.spyOn(Account, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(FbToken, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(Material, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(AdDraft, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(AdTask, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    } as any)
    jest.spyOn(FacebookApp, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenFindResult([{
      _id: '665000000000000000000198',
      fbUserId: 'fb_missing_config',
      fbUserName: 'Facebook User',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastCheckedAt: new Date(),
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(leanFindResult([{
      fbUserId: 'fb_missing_config',
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_1', name: 'Ready account', status: 1 }],
      pages: [{ pageId: 'page_1', name: 'Page 1', accounts: [{ accountId: 'act_1' }] }],
      pixels: [{ pixelId: 'pixel_1', name: 'Pixel 1', accounts: [{ accountId: 'act_1' }] }],
    }]) as any)

    const readiness = await getCommercialReadiness({
      userId: 'admin',
      role: UserRole.SUPER_ADMIN,
    } as any)

    expect(readiness.checklist.find(item => item.id === 'facebook_business_login_config')?.status).toBe('blocked')
    expect(readiness.state.level).toBe('blocked')
    expect(readiness.risks.some(risk => risk.message.includes('config_id'))).toBe(true)
    expect(readiness.nextActions.some(action => action.id === 'configure_business_login_config')).toBe(true)
  })

  it('warns when active facebook tokens are expiring soon or stale', async () => {
    jest.spyOn(User, 'countDocuments')
      .mockResolvedValueOnce(2 as any)
      .mockResolvedValueOnce(2 as any)
    jest.spyOn(Account, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(FbToken, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(Material, 'countDocuments').mockResolvedValue(3 as any)
    jest.spyOn(AdDraft, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(AdTask, 'find').mockReturnValue(sortedLeanFindResult([]) as any)
    jest.spyOn(FacebookApp, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenFindResult([{
      _id: '665000000000000000000299',
      fbUserId: 'fb_expiring',
      fbUserName: 'Expiring User',
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      lastCheckedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(leanFindResult([{
      fbUserId: 'fb_expiring',
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_1', name: 'Ready account', status: 1 }],
      pages: [{ pageId: 'page_1', name: 'Page 1', accounts: [{ accountId: 'act_1' }] }],
      pixels: [{ pixelId: 'pixel_1', name: 'Pixel 1', accounts: [{ accountId: 'act_1' }] }],
    }]) as any)

    const readiness = await getCommercialReadiness({
      userId: 'admin',
      role: UserRole.SUPER_ADMIN,
    } as any)

    expect(readiness.checklist.find(item => item.id === 'facebook_token_health')?.status).toBe('warning')
    expect(readiness.metrics.expiringSoonTokens).toBe(1)
    expect(readiness.metrics.staleTokenChecks).toBe(1)
    expect(readiness.risks.some(risk => risk.message.includes('14 天内过期'))).toBe(true)
    expect(readiness.nextActions.map(action => action.id)).toEqual(expect.arrayContaining([
      'renew_expiring_facebook_tokens',
      'refresh_facebook_token_checks',
    ]))
  })

  it('keeps token last-check health in commercial support packages', async () => {
    jest.spyOn(User, 'countDocuments')
      .mockResolvedValueOnce(2 as any)
      .mockResolvedValueOnce(2 as any)
    jest.spyOn(Account, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(FbToken, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(Material, 'countDocuments').mockResolvedValue(3 as any)
    jest.spyOn(AdDraft, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(FacebookApp, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)

    const token = {
      _id: '665000000000000000000399',
      fbUserId: 'fb_fresh',
      fbUserName: 'Fresh User',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastCheckedAt: new Date(),
    }
    const readinessTokenFind = tokenFindResult([token])
    const supportTokenFind = tokenFindResult([token])
    jest.spyOn(FbToken, 'find')
      .mockReturnValueOnce(readinessTokenFind as any)
      .mockReturnValueOnce(supportTokenFind as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(leanFindResult([{
      fbUserId: 'fb_fresh',
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_1', name: 'Ready account', status: 1 }],
      pages: [{ pageId: 'page_1', name: 'Page 1', accounts: [{ accountId: 'act_1' }] }],
      pixels: [{ pixelId: 'pixel_1', name: 'Pixel 1', accounts: [{ accountId: 'act_1' }] }],
    }]) as any)
    jest.spyOn(AdTask, 'find')
      .mockReturnValueOnce(sortedLeanFindResult([]) as any)
      .mockReturnValueOnce(sortedLeanFindResult([]) as any)
    jest.spyOn(OpsLog, 'find').mockReturnValue(sortedLeanFindResult([]) as any)
    jest.spyOn(FacebookApp, 'find').mockReturnValue(sortedLeanFindResult([{
      appId: '2165550037551429',
      appName: 'page-advance',
      status: 'active',
      stats: { totalRequests: 10, successRequests: 9 },
      validation: { isValid: true },
      config: { enabledForBulkAds: true, businessLoginConfigId: '1544502593866149' },
      compliance: {
        appMode: 'dev',
        businessVerification: 'verified',
        appReview: 'approved',
        permissions: [],
      },
    }]) as any)

    const supportPackage = await getCommercialSupportPackage({
      userId: 'admin',
      role: UserRole.SUPER_ADMIN,
    } as any)

    expect(supportTokenFind.select).toHaveBeenCalledWith(expect.stringContaining('lastCheckedAt'))
    expect(supportPackage.system.build).toMatchObject({
      ref: 'feat/commercial-saas-foundation',
      commit: '1234567890abcdef',
      shortCommit: '1234567890ab',
      deployedAt: '2026-06-01T12:00:00Z',
    })
    expect(supportPackage.facebookAssets.summary.staleTokenCheckCount).toBe(0)
    expect(supportPackage.facebookApps.summary).toMatchObject({
      total: 1,
      ready: 0,
      blocked: 1,
    })
    expect(supportPackage.facebookApps.apps[0]).toMatchObject({
      appId: '2165550037551429',
      publicOauthReady: false,
      gapCount: expect.any(Number),
    })
    expect(supportPackage.facebookApps.apps[0].gapCodes).toContain('APP_MODE_NOT_LIVE')
  })

  it('caps readiness score when critical commercial blockers exist', async () => {
    jest.spyOn(User, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(Account, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(FbToken, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(Material, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(AdDraft, 'countDocuments').mockResolvedValue(0 as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(AdTask, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    } as any)
    jest.spyOn(FacebookApp, 'countDocuments')
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenFindResult([{
      _id: '665000000000000000000199',
      fbUserId: 'fb_critical',
      fbUserName: 'Facebook User',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(leanFindResult([{
      fbUserId: 'fb_critical',
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_1', name: 'Account without pixel', status: 1 }],
      pages: [{ pageId: 'page_1', name: 'Page 1', accounts: [{ accountId: 'act_1' }] }],
      pixels: [],
    }]) as any)

    const readiness = await getCommercialReadiness({
      userId: 'admin',
      role: UserRole.SUPER_ADMIN,
    } as any)

    expect(readiness.risks.some(risk => risk.level === 'critical')).toBe(true)
    expect(readiness.score).toBeLessThanOrEqual(49)
    expect(readiness.state).toMatchObject({
      level: 'blocked',
      label: '未就绪',
    })
    expect(readiness.nextActions.map(action => action.id)).toEqual(expect.arrayContaining([
      'complete_public_oauth_app',
      'assign_facebook_pixel',
    ]))
  })

  it('marks readiness blocked when bulk ad create feature is disabled', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization({
      settings: {
        features: ['facebook_oauth', 'material_library', 'team_management'],
      },
    }) as any)
    jest.spyOn(User, 'countDocuments')
      .mockResolvedValueOnce(2 as any)
      .mockResolvedValueOnce(2 as any)
    jest.spyOn(Account, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(FbToken, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(Material, 'countDocuments').mockResolvedValue(3 as any)
    jest.spyOn(AdDraft, 'countDocuments').mockResolvedValue(1 as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(AdTask, 'find').mockReturnValue(sortedLeanFindResult([]) as any)
    jest.spyOn(FacebookApp, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(1 as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenFindResult([{
      _id: '665000000000000000000399',
      fbUserId: 'fb_ready',
      fbUserName: 'Ready User',
      lastCheckedAt: new Date(),
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(leanFindResult([{
      fbUserId: 'fb_ready',
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_1', name: 'Ready account', status: 1 }],
      pages: [{ pageId: 'page_1', name: 'Page 1', accounts: [{ accountId: 'act_1' }] }],
      pixels: [{ pixelId: 'pixel_1', name: 'Pixel 1', accounts: [{ accountId: 'act_1' }] }],
    }]) as any)

    const readiness = await getCommercialReadiness({
      userId: 'org_admin',
      role: UserRole.ORG_ADMIN,
      organizationId,
    } as any)

    expect(readiness.checklist.find(item => item.id === 'bulk_ad_feature')).toMatchObject({
      status: 'blocked',
      metric: '未开启',
    })
    expect(readiness.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'critical',
        message: expect.stringContaining('未开通批量建广告功能'),
      }),
    ]))
    expect(readiness.nextActions.map(action => action.id)).toContain('enable_bulk_ad_feature')
    expect(readiness.metrics.enabledFeatures).toBe(3)
    expect(readiness.state.level).toBe('blocked')
  })

  it('returns a commercial usage ledger with daily task counts and quota events', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue(mockOrganization({ name: 'Acme Team' }) as any)
    jest.spyOn(User, 'countDocuments').mockResolvedValue(3 as any)
    jest.spyOn(Account, 'countDocuments').mockResolvedValue(5 as any)
    jest.spyOn(Material, 'countDocuments').mockResolvedValue(20 as any)
    jest.spyOn(AdTask, 'countDocuments')
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValueOnce(12 as any)
    jest.spyOn(AdTask, 'aggregate')
      .mockResolvedValueOnce([
        { _id: 'success', tasks: 8, accounts: 16 },
        { _id: 'failed', tasks: 4, accounts: 8 },
      ] as any)
      .mockResolvedValueOnce([
        { _id: { day: '2026-06-01', status: 'success' }, tasks: 2, accounts: 4 },
        { _id: { day: '2026-06-01', status: 'failed' }, tasks: 1, accounts: 2 },
      ] as any)
    jest.spyOn(AdTask, 'find').mockReturnValue(sortedLeanFindResult([{
      _id: '665000000000000000000301',
      name: 'Recent task',
      status: 'failed',
      createdAt: new Date('2026-06-01T08:00:00.000Z'),
      items: [{
        accountId: 'act_1',
        accountName: 'Account 1',
        status: 'failed',
        errors: [{
          errorCode: 'PAGE_ACCESS_REQUIRED',
          errorMessage: 'Page access missing',
        }],
      }],
      progress: { totalAccounts: 1, createdAds: 0 },
    }]) as any)
    jest.spyOn(OpsLog, 'find').mockReturnValue(sortedLeanFindResult([{
      action: 'bulk_ad.publish',
      status: 'failed',
      summary: '发布批量广告任务失败',
      reason: '本月任务额度不足',
      metadata: {
        errorCode: 'MONTHLY_TASK_LIMIT_REACHED',
        details: { monthlyTaskCount: 12, requestedTasks: 1, limit: 20, plan: OrganizationPlan.STARTER },
      },
      requestId: 'req_ledger',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
      username: 'operator',
      userRole: 'super_admin',
    }]) as any)

    const ledger = await getCommercialUsageLedger({
      userId: 'user_1',
      role: UserRole.ORG_ADMIN,
      organizationId,
    } as any)

    expect(ledger.scope).toMatchObject({
      mode: 'organization',
      organizationName: 'Acme Team',
    })
    expect(ledger.plan.code).toBe(OrganizationPlan.STARTER)
    expect(ledger.usage.monthlyTasks.used).toBe(12)
    expect(ledger.usage.concurrentTasks.used).toBe(1)
    expect(ledger.taskStatusBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'success', tasks: 8, accountExecutions: 16 }),
      expect.objectContaining({ status: 'failed', tasks: 4, accountExecutions: 8 }),
    ]))
    expect(ledger.dailyTaskCounts.find(day => day.date === '2026-06-01')).toMatchObject({
      totalTasks: 3,
      successTasks: 2,
      failedTasks: 1,
      accountExecutions: 6,
    })
    expect(ledger.quotaEvents[0]).toMatchObject({
      errorCode: 'MONTHLY_TASK_LIMIT_REACHED',
      operator: 'operator',
    })
    expect(ledger.recentTasks[0]).toMatchObject({
      taskName: 'Recent task',
      status: 'failed',
      totalErrors: 1,
    })
    expect(ledger.issueTrends[0]).toMatchObject({
      errorCode: 'PAGE_ACCESS_REQUIRED',
      count: 1,
      taskCount: 1,
      accountCount: 1,
      retryable: false,
    })
  })
})
