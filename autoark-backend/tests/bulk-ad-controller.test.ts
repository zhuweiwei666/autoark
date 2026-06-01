jest.mock('../src/services/bulkAd.service', () => ({
  __esModule: true,
  default: {
    getTaskSupportPackage: jest.fn(),
    rerunTask: jest.fn(),
  },
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: jest.fn(),
}))

import bulkAdService from '../src/services/bulkAd.service'
import { writeAuditLog } from '../src/services/auditLog.service'
import { getTaskSupportPackage, rerunTask } from '../src/controllers/bulkAd.controller'

const mockBulkAdService = bulkAdService as jest.Mocked<typeof bulkAdService>
const mockWriteAuditLog = writeAuditLog as jest.Mock

describe('bulk ad controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
})
