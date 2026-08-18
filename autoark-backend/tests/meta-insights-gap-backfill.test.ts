const mockCoverageFind = jest.fn()
const mockRefreshAggregation = jest.fn()
const mockFreezeCoverage = jest.fn()

jest.mock('../src/models/MetaInsightsCoverage', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockCoverageFind(...args),
  },
}))

jest.mock('../src/services/aggregation.service', () => ({
  refreshAggregation: (...args: any[]) => mockRefreshAggregation(...args),
}))

jest.mock('../src/services/metaInsightsPersistence.service', () => ({
  freezeMatureMetaInsightsCoverage: (...args: any[]) =>
    mockFreezeCoverage(...args),
}))

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { runPendingMetaInsightsGapBackfill } from '../src/services/metaInsightsGapBackfill.service'

const gapQuery = (rows: any[]) => ({
  select: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(rows),
      }),
    }),
  }),
})

describe('Meta insights coverage gap backfill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.FACEBOOK_AGGREGATION_ENABLED = 'true'
    mockCoverageFind.mockReturnValue(
      gapQuery([
        { date: '2026-08-10', accountId: 'act_101' },
        { date: '2026-08-10', accountId: '102' },
        { date: '2026-08-11', accountId: '101' },
      ]),
    )
    mockRefreshAggregation
      .mockResolvedValueOnce({ processedAccountIds: ['101', '102'] })
      .mockResolvedValueOnce({ processedAccountIds: ['101'] })
    mockFreezeCoverage.mockResolvedValue(4)
  })

  afterEach(() => {
    delete process.env.FACEBOOK_AGGREGATION_ENABLED
  })

  it('groups due gaps by date and retries only those account-days', async () => {
    const result = await runPendingMetaInsightsGapBackfill()

    expect(mockRefreshAggregation).toHaveBeenNthCalledWith(
      1,
      '2026-08-10',
      true,
      { accountIds: ['101', '102'], ignoreRetryBackoff: true },
    )
    expect(mockRefreshAggregation).toHaveBeenNthCalledWith(
      2,
      '2026-08-11',
      true,
      { accountIds: ['101'], ignoreRetryBackoff: true },
    )
    expect(result).toEqual({
      attemptedPairs: 3,
      completedPairs: 3,
      pendingPairs: 0,
      frozenRows: 4,
      dates: ['2026-08-10', '2026-08-11'],
    })
  })
})
