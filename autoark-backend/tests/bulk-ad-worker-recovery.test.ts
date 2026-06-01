jest.mock('../src/config/redis', () => ({
  getRedisClient: jest.fn(() => null),
  getRedisConnection: jest.fn(),
}))

import AdTask from '../src/models/AdTask'
import { recoverStuckTasks } from '../src/queue/bulkAd.worker'

const oldDate = () => new Date(Date.now() - 60 * 60 * 1000)

describe('bulk ad worker stuck task recovery', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('marks old queued pending items as failed with worker timeout diagnostics', async () => {
    const task: any = {
      _id: '665000000000000000000801',
      status: 'queued',
      queuedAt: oldDate(),
      items: [{
        accountId: '123',
        accountName: 'Account 123',
        status: 'pending',
        errors: [],
      }],
      progress: { totalAccounts: 1, completedAccounts: 0, failedAccounts: 0, percentage: 0 },
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(AdTask, 'find').mockResolvedValue([task] as any)

    await recoverStuckTasks()

    expect(task.status).toBe('failed')
    expect(task.progress).toMatchObject({
      totalAccounts: 1,
      completedAccounts: 1,
      failedAccounts: 1,
      percentage: 100,
    })
    expect(task.items[0]).toMatchObject({
      status: 'failed',
      errors: [expect.objectContaining({
        errorCode: 'WORKER_TIMEOUT',
        retryable: true,
      })],
    })
    expect(task.items[0].completedAt).toBeInstanceOf(Date)
    expect(task.save).toHaveBeenCalled()
  })

  it('keeps successful accounts and marks stale pending accounts as partial success', async () => {
    const task: any = {
      _id: '665000000000000000000802',
      status: 'processing',
      startedAt: oldDate(),
      items: [
        {
          accountId: 'success_1',
          status: 'success',
          result: { createdCount: 2 },
          errors: [],
        },
        {
          accountId: 'pending_1',
          status: 'pending',
          errors: [],
        },
      ],
      progress: { totalAccounts: 2, completedAccounts: 1, successAccounts: 1, failedAccounts: 0, percentage: 50 },
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(AdTask, 'find').mockResolvedValue([task] as any)

    await recoverStuckTasks()

    expect(task.status).toBe('partial_success')
    expect(task.progress).toMatchObject({
      totalAccounts: 2,
      completedAccounts: 2,
      successAccounts: 1,
      failedAccounts: 1,
      createdAds: 2,
      percentage: 100,
    })
    expect(task.items[0].status).toBe('success')
    expect(task.items[1].errors[0]).toMatchObject({
      errorCode: 'WORKER_TIMEOUT',
      source: 'worker',
    })
    expect(task.save).toHaveBeenCalled()
  })
})
