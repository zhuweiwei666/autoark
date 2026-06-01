import Account from '../src/models/Account'
import AdTask from '../src/models/AdTask'
import AdDraft from '../src/models/AdDraft'
import FacebookApp from '../src/models/FacebookApp'
import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import Material from '../src/models/Material'
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
  })
})
