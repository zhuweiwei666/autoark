const mockAccountFind = jest.fn()
const mockAccountUpdateMany = jest.fn()
const mockRefreshAggregation = jest.fn()

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockAccountFind(...args),
    updateMany: (...args: any[]) => mockAccountUpdateMany(...args),
  },
}))

jest.mock('../src/services/aggregation.service', () => ({
  refreshAggregation: (...args: any[]) => mockRefreshAggregation(...args),
}))

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import {
  runPendingAccountInsightsBackfill,
} from '../src/services/accountInsightsBackfill.service'

const pendingAccountsQuery = (accounts: Array<{ accountId: string }>) => ({
  select: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(accounts),
      }),
    }),
  }),
})

describe('pending account insights backfill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T04:30:00.000Z'))
    mockAccountFind.mockReturnValue(pendingAccountsQuery([
      { accountId: '101' },
      { accountId: '102' },
    ]))
    mockAccountUpdateMany.mockResolvedValue({ modifiedCount: 2 })
    mockRefreshAggregation
      .mockResolvedValueOnce({
        processedAccountIds: ['101', '102'],
        cachedAccountIds: [],
        unavailableAccountIds: [],
      })
      .mockResolvedValueOnce({
        processedAccountIds: ['101'],
        cachedAccountIds: [],
        unavailableAccountIds: ['102'],
      })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('backfills the previous two Shanghai days and only completes fully resolved accounts', async () => {
    const result = await runPendingAccountInsightsBackfill()

    expect(mockRefreshAggregation).toHaveBeenNthCalledWith(
      1,
      '2026-08-04',
      true,
      { accountIds: ['101', '102'], ignoreRetryBackoff: true },
    )
    expect(mockRefreshAggregation).toHaveBeenNthCalledWith(
      2,
      '2026-08-03',
      true,
      { accountIds: ['101', '102'], ignoreRetryBackoff: true },
    )
    expect(mockAccountUpdateMany).toHaveBeenLastCalledWith(
      { channel: 'facebook', accountId: { $in: ['101', 'act_101'] } },
      {
        $set: {
          insightsBackfillCompletedAt: new Date('2026-08-05T04:30:00.000Z'),
        },
        $unset: {
          insightsBackfillPendingSince: 1,
          insightsBackfillLastAttemptAt: 1,
        },
      },
    )
    expect(result).toEqual({
      attemptedAccounts: 2,
      completedAccounts: 1,
      pendingAccounts: 1,
      dates: ['2026-08-04', '2026-08-03'],
    })
  })
})
