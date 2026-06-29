jest.mock('../src/config/redis', () => ({
  getRedisClient: jest.fn(() => ({ status: 'ready' })),
}))

jest.mock('../src/queue/bulkAd.queue', () => ({
  addBulkAdJobsBatch: jest.fn().mockResolvedValue([]),
}))

import AdTask from '../src/models/AdTask'
import { addBulkAdJobsBatch } from '../src/queue/bulkAd.queue'
import { retryFailedItems } from '../src/services/bulkAd.service'

describe('bulk ad retry guardrails', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('rejects retry when every failed item is blocked by non-retryable diagnostics', async () => {
    const task: any = {
      _id: '665000000000000000000301',
      status: 'failed',
      items: [{
        accountId: '123',
        accountName: 'Account 123',
        status: 'failed',
        errors: [{
          errorCode: 'AD_ACCOUNT_ACCESS_DENIED',
          errorMessage: 'No access to ad account',
        }],
      }],
      progress: { totalAccounts: 1, failedAccounts: 1, percentage: 100 },
      retryInfo: { retryCount: 0 },
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(AdTask, 'findOne').mockResolvedValue(task)

    await expect(retryFailedItems(task._id, {})).rejects.toThrow('没有可重试的失败项')

    expect(task.items[0].status).toBe('failed')
    expect(task.save).not.toHaveBeenCalled()
    expect(addBulkAdJobsBatch).not.toHaveBeenCalled()
  })

  it('queues only retryable failed items and leaves blocked items untouched', async () => {
    const task: any = {
      _id: '665000000000000000000302',
      status: 'failed',
      items: [
        {
          accountId: 'retryable_1',
          accountName: 'Retryable account',
          status: 'failed',
          errors: [{
            errorCode: 'META_RATE_LIMIT',
            errorMessage: 'Rate limit',
          }],
        },
        {
          accountId: 'blocked_1',
          accountName: 'Blocked account',
          status: 'failed',
          errors: [{
            errorCode: 'PIXEL_ACCESS_REQUIRED',
            errorMessage: 'Pixel missing',
          }],
        },
      ],
      progress: { totalAccounts: 2, failedAccounts: 2, percentage: 100 },
      retryInfo: { retryCount: 1 },
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(AdTask, 'findOne').mockResolvedValue(task)

    await retryFailedItems(task._id, {})

    expect(task.items[0]).toMatchObject({ status: 'pending', errors: [] })
    expect(task.items[1].status).toBe('failed')
    expect(task.status).toBe('queued')
    expect(task.retryInfo.retryCount).toBe(2)
    expect(task.progress.failedAccounts).toBe(1)
    expect(addBulkAdJobsBatch).toHaveBeenCalledWith(
      task._id.toString(),
      ['retryable_1'],
      1,
      expect.stringMatching(/^retry-2-/),
    )
  })
})
