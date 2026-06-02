import AdTask from '../src/models/AdTask'
import AdDraft from '../src/models/AdDraft'
import {
  getDraftList,
  getTaskList,
} from '../src/services/bulkAd.service'

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

  it('filters task list by diagnostic health and error code', async () => {
    const blockedTask = {
      _id: '665000000000000000000601',
      status: 'failed',
      items: [{
        accountId: 'act_blocked',
        accountName: 'Blocked Account',
        status: 'failed',
        errors: ['Selected pixel_id cannot be loaded due to missing permissions'],
      }],
      progress: {
        totalAccounts: 1,
        completedAccounts: 1,
        successAccounts: 0,
        failedAccounts: 1,
        totalAds: 0,
        createdAds: 0,
        percentage: 100,
      },
    }
    const retryableTask = {
      _id: '665000000000000000000602',
      status: 'failed',
      items: [{
        accountId: 'act_retry',
        accountName: 'Retry Account',
        status: 'failed',
        errors: ['Application request limit reached'],
      }],
      progress: {
        totalAccounts: 1,
        completedAccounts: 1,
        successAccounts: 0,
        failedAccounts: 1,
        totalAds: 0,
        createdAds: 0,
        percentage: 100,
      },
    }
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([blockedTask, retryableTask]),
    }
    jest.spyOn(AdTask, 'find').mockReturnValue(findQuery as any)

    const blockedResult = await getTaskList({ diagnosticHealth: 'blocked' }, {})
    const rateLimitResult = await getTaskList({ errorCode: 'meta_rate_limit' }, {})

    expect(blockedResult.total).toBe(1)
    expect(blockedResult.list[0]._id).toBe(blockedTask._id)
    expect(rateLimitResult.total).toBe(1)
    expect(rateLimitResult.list[0]._id).toBe(retryableTask._id)
    expect(findQuery.limit).toHaveBeenCalledWith(1001)
  })

  it('caps diagnostic task scans before in-memory filtering', async () => {
    const blockedTask = {
      _id: '665000000000000000000701',
      status: 'failed',
      items: [{
        accountId: 'act_blocked',
        accountName: 'Blocked Account',
        status: 'failed',
        errors: ['Selected pixel_id cannot be loaded due to missing permissions'],
      }],
      progress: {
        totalAccounts: 1,
        completedAccounts: 1,
        successAccounts: 0,
        failedAccounts: 1,
        totalAds: 0,
        createdAds: 0,
        percentage: 100,
      },
    }
    const olderTask = {
      _id: '665000000000000000000702',
      status: 'failed',
      items: [{
        accountId: 'act_retry',
        accountName: 'Retry Account',
        status: 'failed',
        errors: ['Application request limit reached'],
      }],
      progress: {
        totalAccounts: 1,
        completedAccounts: 1,
        successAccounts: 0,
        failedAccounts: 1,
        totalAds: 0,
        createdAds: 0,
        percentage: 100,
      },
    }
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([blockedTask, olderTask]),
    }
    jest.spyOn(AdTask, 'find').mockReturnValue(findQuery as any)

    const result = await getTaskList({ diagnosticHealth: 'blocked', diagnosticScanLimit: '1' }, {})

    expect(findQuery.limit).toHaveBeenCalledWith(2)
    expect(result.list).toHaveLength(1)
    expect(result.list[0]._id).toBe(blockedTask._id)
    expect(result.meta).toMatchObject({
      diagnosticScan: {
        enabled: true,
        scanLimit: 1,
        scannedCount: 1,
        matchedCount: 1,
        truncated: true,
      },
    })
  })

  it('caps task list page size before querying the database', async () => {
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    jest.spyOn(AdTask, 'find').mockReturnValue(findQuery as any)
    jest.spyOn(AdTask, 'countDocuments').mockResolvedValue(0 as any)

    const result = await getTaskList({ page: '3', pageSize: '10000' }, {})

    expect(findQuery.skip).toHaveBeenCalledWith(200)
    expect(findQuery.limit).toHaveBeenCalledWith(100)
    expect(result).toMatchObject({ page: 3, pageSize: 100 })
  })

  it('sanitizes task list filters before querying the database', async () => {
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    jest.spyOn(AdTask, 'find').mockReturnValue(findQuery as any)
    jest.spyOn(AdTask, 'countDocuments').mockResolvedValue(0 as any)

    await getTaskList({
      status: { $ne: 'failed' },
      taskType: 'DROP',
      platform: 'facebook',
    }, { organizationId: '665000000000000000000001' })

    expect(AdTask.find).toHaveBeenCalledWith({
      organizationId: '665000000000000000000001',
      platform: 'facebook',
    })
    expect(AdTask.countDocuments).toHaveBeenCalledWith({
      organizationId: '665000000000000000000001',
      platform: 'facebook',
    })
  })

  it('caps draft list page size before querying the database', async () => {
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    jest.spyOn(AdDraft, 'find').mockReturnValue(findQuery as any)
    jest.spyOn(AdDraft, 'countDocuments').mockResolvedValue(0 as any)

    const result = await getDraftList({ page: '2', pageSize: '10000' }, {})

    expect(findQuery.skip).toHaveBeenCalledWith(100)
    expect(findQuery.limit).toHaveBeenCalledWith(100)
    expect(result).toMatchObject({ page: 2, pageSize: 100 })
  })

  it('sanitizes draft list status filters before querying the database', async () => {
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    jest.spyOn(AdDraft, 'find').mockReturnValue(findQuery as any)
    jest.spyOn(AdDraft, 'countDocuments').mockResolvedValue(0 as any)

    await getDraftList({ status: { $ne: 'draft' } }, { createdBy: '665000000000000000000002' })

    expect(AdDraft.find).toHaveBeenCalledWith({ createdBy: '665000000000000000000002' })
    expect(AdDraft.countDocuments).toHaveBeenCalledWith({ createdBy: '665000000000000000000002' })
  })
})
