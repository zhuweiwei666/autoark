import AdTask from '../src/models/AdTask'
import OpsLog from '../src/models/OpsLog'
import { getTaskSupportPackage } from '../src/services/bulkAd.service'

const taskId = '665000000000000000000401'

const taskQuery = (value: any) => ({
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
})

const auditQuery = (value: any) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
})

const originalDeployRef = process.env.AUTOARK_DEPLOY_REF
const originalDeployCommit = process.env.AUTOARK_DEPLOY_COMMIT
const originalDeployedAt = process.env.AUTOARK_DEPLOYED_AT

describe('bulk ad task support package', () => {
  beforeEach(() => {
    process.env.AUTOARK_DEPLOY_REF = 'feat/commercial-saas-foundation'
    process.env.AUTOARK_DEPLOY_COMMIT = '1234567890abcdef'
    process.env.AUTOARK_DEPLOYED_AT = '2026-06-01T12:00:00Z'
  })

  afterEach(() => {
    jest.restoreAllMocks()
    for (const [key, value] of Object.entries({
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

  it('builds an operator support package with normalized diagnostics and safe audit history', async () => {
    jest.spyOn(AdTask, 'findOne').mockReturnValue(taskQuery({
      _id: taskId,
      name: 'autoark_demo_task',
      status: 'failed',
      platform: 'facebook',
      taskType: 'BULK_AD_CREATE',
      organizationId: '665000000000000000000001',
      createdBy: '665000000000000000000002',
      createdAt: new Date('2026-06-01T08:00:00.000Z'),
      progress: { totalAccounts: 2, successAccounts: 1, failedAccounts: 1, createdAds: 3, percentage: 100 },
      configSnapshot: {
        accounts: [{ accountId: 'act_123', accessToken: 'EAA123456789012345678901234567890' }],
      },
      items: [
        {
          accountId: 'act_123',
          accountName: 'Account 123',
          status: 'failed',
          result: { createdCount: 0 },
          errors: [{
            code: 100,
            message: 'Selected pixel_id cannot be loaded due to missing permissions access_token=EAA123456789012345678901234567890',
          }],
        },
        {
          accountId: 'act_456',
          accountName: 'Account 456',
          status: 'success',
          result: { createdCount: 3 },
          errors: [],
        },
      ],
    }) as any)
    jest.spyOn(OpsLog, 'find').mockReturnValue(auditQuery([{
      category: 'bulk_ad',
      action: 'bulk_ad.retry',
      status: 'failed',
      targetType: 'ad_task',
      targetId: taskId,
      summary: '重试批量广告任务失败',
      reason: 'token=EAA123456789012345678901234567890',
      requestId: 'req_1',
      createdAt: new Date('2026-06-01T08:10:00.000Z'),
    }]) as any)

    const supportPackage = await getTaskSupportPackage(taskId, { organizationId: '665000000000000000000001' })

    expect(supportPackage.supportId).toMatch(/^AUTOARK-TASK-\d{14}-000401$/)
    expect(supportPackage.system.build).toMatchObject({
      ref: 'feat/commercial-saas-foundation',
      commit: '1234567890abcdef',
      shortCommit: '1234567890ab',
      deployedAt: '2026-06-01T12:00:00Z',
    })
    expect(supportPackage.task).toMatchObject({
      id: taskId,
      name: 'autoark_demo_task',
      status: 'failed',
      platform: 'facebook',
    })
    expect(supportPackage.diagnostics.health).toBe('blocked')
    expect(supportPackage.diagnostics.summary.failedAccounts).toBe(1)
    expect(supportPackage.diagnostics.buckets[0]).toMatchObject({
      errorCode: 'PIXEL_ACCESS_REQUIRED',
      retryable: false,
    })
    expect(supportPackage.failedItems[0].errors[0].operatorMessage).toContain('[REDACTED]')
    expect(supportPackage.recentAuditLogs[0].reason).toContain('[REDACTED]')
    expect(JSON.stringify(supportPackage)).not.toMatch(/EAA123456789012345678901234567890/)
    expect(JSON.stringify(supportPackage)).not.toMatch(/accessToken/)
  })

  it('bounds failed items and per-item errors while reporting truncation metadata', async () => {
    const failedItems = Array.from({ length: 25 }, (_, index) => ({
      accountId: `act_${index + 1}`,
      accountName: `Account ${index + 1}`,
      status: 'failed',
      errors: Array.from({ length: 7 }, (__, errorIndex) => ({
        code: 100,
        message: `Pixel permission issue ${errorIndex + 1} access_token=EAA123456789012345678901234567890`,
      })),
    }))

    jest.spyOn(AdTask, 'findOne').mockReturnValue(taskQuery({
      _id: taskId,
      name: 'large_failure_task',
      status: 'failed',
      platform: 'facebook',
      taskType: 'BULK_AD_CREATE',
      organizationId: '665000000000000000000001',
      createdBy: '665000000000000000000002',
      progress: { totalAccounts: 25, successAccounts: 0, failedAccounts: 25, createdAds: 0, percentage: 100 },
      items: failedItems,
    }) as any)
    jest.spyOn(OpsLog, 'find').mockReturnValue(auditQuery([]) as any)

    const supportPackage = await getTaskSupportPackage(taskId, { organizationId: '665000000000000000000001' })

    expect(supportPackage.failedItems).toHaveLength(20)
    expect(supportPackage.failedItems[0].errors).toHaveLength(5)
    expect(supportPackage.failedItems[0]).toMatchObject({
      errorTotal: 7,
      errorsTruncated: true,
    })
    expect(supportPackage.limits).toMatchObject({
      failedItems: {
        total: 25,
        returned: 20,
        maxReturned: 20,
        truncated: true,
      },
      itemErrors: {
        maxReturned: 5,
      },
    })
    expect(JSON.stringify(supportPackage)).not.toMatch(/EAA123456789012345678901234567890/)
  })

  it('throws when the task is not visible in the current scope', async () => {
    jest.spyOn(AdTask, 'findOne').mockReturnValue(taskQuery(null) as any)

    await expect(getTaskSupportPackage(taskId, { organizationId: '665000000000000000000001' }))
      .rejects.toThrow('Task not found')
  })
})
