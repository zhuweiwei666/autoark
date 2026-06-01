import AdTask from '../src/models/AdTask'
import { getTaskList } from '../src/services/bulkAd.service'

describe('bulk ad task list', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('includes compact operational diagnostics for list triage', async () => {
    const task = {
      _id: '665000000000000000000501',
      status: 'failed',
      items: [
        {
          accountId: 'act_1',
          accountName: 'Account 1',
          status: 'failed',
          errors: [{
            code: 100,
            message: 'Selected pixel_id cannot be loaded due to missing permissions',
          }],
        },
        {
          accountId: 'act_2',
          accountName: 'Account 2',
          status: 'failed',
          errors: ['Application request limit reached'],
        },
      ],
      progress: {
        totalAccounts: 2,
        completedAccounts: 2,
        successAccounts: 0,
        failedAccounts: 2,
        totalAds: 0,
        createdAds: 0,
        percentage: 100,
      },
    }
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([task]),
    }
    jest.spyOn(AdTask, 'find').mockReturnValue(findQuery as any)
    jest.spyOn(AdTask, 'countDocuments').mockResolvedValue(1 as any)

    const result = await getTaskList({}, {})

    expect(result.total).toBe(1)
    expect(result.list[0].operationalDiagnostics).toMatchObject({
      health: 'mixed',
      summary: {
        totalErrors: 2,
        retryableErrors: 1,
        blockedErrors: 1,
      },
    })
    expect(result.list[0].operationalDiagnostics.buckets.map((bucket: any) => bucket.errorCode)).toEqual([
      'PIXEL_ACCESS_REQUIRED',
      'META_RATE_LIMIT',
    ])
  })
})
