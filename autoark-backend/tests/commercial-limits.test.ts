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

describe('commercial publish limits', () => {
  afterEach(() => {
    jest.restoreAllMocks()
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
