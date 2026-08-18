const mockTokenFind = jest.fn()
const mockTokenFindByIdAndUpdate = jest.fn()
const mockAccountFind = jest.fn()
const mockRefreshAggregation = jest.fn()
const mockGetFreshCoverageAccountIds = jest.fn()

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockTokenFind(...args),
    findByIdAndUpdate: (...args: any[]) => mockTokenFindByIdAndUpdate(...args),
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockAccountFind(...args),
  },
}))

jest.mock('../src/services/aggregation.service', () => ({
  refreshAggregation: (...args: any[]) => mockRefreshAggregation(...args),
}))

jest.mock('../src/services/metaInsightsPersistence.service', () => ({
  getFreshCoverageAccountIds: (...args: any[]) =>
    mockGetFreshCoverageAccountIds(...args),
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
  markTokenInsightsBackfillPending,
  runPendingTokenInsightsBackfill,
} from '../src/services/tokenInsightsBackfill.service'

const pendingTokensQuery = (tokens: Array<{ _id: string }>) => ({
  select: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(tokens),
      }),
    }),
  }),
})

const tokenAccountsQuery = (accounts: Array<{ accountId: string }>) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(accounts),
  }),
})

describe('token authorization insights backfill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-08-06T03:30:00.000Z'))
    process.env.FACEBOOK_AGGREGATION_ENABLED = 'true'
    mockTokenFind.mockReturnValue(pendingTokensQuery([{ _id: 'token-1' }]))
    mockAccountFind.mockReturnValue(tokenAccountsQuery([
      { accountId: '101' },
      { accountId: '102' },
    ]))
    mockTokenFindByIdAndUpdate.mockResolvedValue({})
    mockGetFreshCoverageAccountIds.mockResolvedValue(new Set())
    mockRefreshAggregation.mockResolvedValue({
      processedAccountIds: ['101', '102'],
      cachedAccountIds: [],
      unavailableAccountIds: [],
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    delete process.env.FACEBOOK_AGGREGATION_ENABLED
  })

  it('persists authorization recovery before any asynchronous asset sync starts', async () => {
    await markTokenInsightsBackfillPending('token-1')

    expect(mockTokenFindByIdAndUpdate).toHaveBeenCalledWith(
      'token-1',
      {
        $set: {
          insightsBackfillPendingSince: new Date('2026-08-06T03:30:00.000Z'),
        },
        $unset: {
          insightsBackfillLastAttemptAt: 1,
          insightsBackfillCompletedAt: 1,
        },
      },
    )
  })

  it('refreshes today and the prior two Shanghai dates for every account on the recovered token', async () => {
    const result = await runPendingTokenInsightsBackfill({ tokenIds: ['token-1'] })

    expect(mockAccountFind).toHaveBeenCalledWith({
      channel: 'facebook',
      tokenId: 'token-1',
      $or: [
        { status: 'active' },
        {
          insightsFinalizationUntil: {
            $gte: new Date('2026-08-06T03:30:00.000Z'),
          },
        },
        { insightsBackfillPendingSince: { $exists: true } },
        { statusChangedAt: { $gte: new Date('2026-08-03T16:00:00.000Z') } },
        { lastActiveAt: { $gte: new Date('2026-08-03T16:00:00.000Z') } },
      ],
    })
    expect(mockRefreshAggregation).toHaveBeenNthCalledWith(
      1,
      '2026-08-04',
      true,
      { accountIds: ['101', '102'], ignoreRetryBackoff: true },
    )
    expect(mockRefreshAggregation).toHaveBeenNthCalledWith(
      2,
      '2026-08-05',
      true,
      { accountIds: ['101', '102'], ignoreRetryBackoff: true },
    )
    expect(mockRefreshAggregation).toHaveBeenNthCalledWith(
      3,
      '2026-08-06',
      true,
      { accountIds: ['101', '102'], ignoreRetryBackoff: true },
    )
    expect(mockTokenFindByIdAndUpdate).toHaveBeenLastCalledWith(
      'token-1',
      {
        $set: {
          insightsBackfillCompletedAt: new Date('2026-08-06T03:30:00.000Z'),
        },
        $unset: {
          insightsBackfillPendingSince: 1,
          insightsBackfillLastAttemptAt: 1,
          insightsGapStartedAt: 1,
          insightsBackfillCursorDate: 1,
        },
      },
    )
    expect(result).toEqual({
      attemptedTokens: 1,
      completedTokens: 1,
      pendingTokens: 0,
      attemptedAccounts: 2,
      dates: ['2026-08-04', '2026-08-05', '2026-08-06'],
    })
  })

  it('keeps recovery pending when Meta fails and only an old cached snapshot is available', async () => {
    mockRefreshAggregation.mockResolvedValue({
      processedAccountIds: [],
      cachedAccountIds: ['101', '102'],
      unavailableAccountIds: [],
    })

    const result = await runPendingTokenInsightsBackfill({ tokenIds: ['token-1'] })

    expect(result).toMatchObject({
      attemptedTokens: 1,
      completedTokens: 0,
      pendingTokens: 1,
    })
    expect(mockTokenFindByIdAndUpdate.mock.calls).not.toEqual(expect.arrayContaining([
      [
        'token-1',
        expect.objectContaining({
          $set: expect.objectContaining({ insightsBackfillCompletedAt: expect.any(Date) }),
        }),
      ],
    ]))
  })

  it('continues a long token outage in bounded date chunks instead of truncating it to three days', async () => {
    mockTokenFind.mockReturnValue(pendingTokensQuery([{
      _id: 'token-1',
      insightsGapStartedAt: new Date('2026-07-20T00:00:00.000Z'),
    } as any]))

    const result = await runPendingTokenInsightsBackfill({ tokenIds: ['token-1'] })

    expect(result).toMatchObject({
      attemptedTokens: 1,
      completedTokens: 0,
      pendingTokens: 1,
      attemptedAccounts: 2,
      dates: [
        '2026-07-20',
        '2026-07-21',
        '2026-07-22',
        '2026-07-23',
        '2026-07-24',
        '2026-07-25',
        '2026-07-26',
      ],
    })
    expect(mockTokenFindByIdAndUpdate).toHaveBeenLastCalledWith(
      'token-1',
      { $set: { insightsBackfillCursorDate: '2026-07-27' } },
    )
  })
})
