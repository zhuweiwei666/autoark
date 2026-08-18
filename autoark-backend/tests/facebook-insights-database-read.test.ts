const mockAxiosGet = jest.fn()
const mockFactFind = jest.fn()
const mockCoverageFind = jest.fn()

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: (...args: any[]) => mockAxiosGet(...args) },
}))

jest.mock('../src/models/MetaInsightsFact', () => ({
  __esModule: true,
  default: { find: (...args: any[]) => mockFactFind(...args) },
}))

jest.mock('../src/models/MetaInsightsCoverage', () => ({
  __esModule: true,
  default: { find: (...args: any[]) => mockCoverageFind(...args) },
}))

import { getInsightsDaily } from '../src/services/facebook.service'

const sortedQuery = (rows: any[]) => ({
  select: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(rows),
    }),
  }),
})

describe('Facebook daily insights history', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reads permanent facts and coverage without a live token or Graph request', async () => {
    mockFactFind.mockReturnValue(
      sortedQuery([
        {
          date: '2026-08-17',
          accountId: '123',
          campaignId: 'cmp-1',
          campaignName: 'Campaign',
          country: 'US',
          spend: 12,
          revenue: 24,
          impressions: 100,
          clicks: 10,
          installs: 3,
        },
      ]),
    )
    mockCoverageFind.mockReturnValue(
      sortedQuery([
        {
          date: '2026-08-17',
          status: 'fresh',
          hasSnapshot: true,
          factRows: 1,
        },
      ]),
    )

    const result = await getInsightsDaily('act_123', {
      since: '2026-08-17',
      until: '2026-08-17',
    })

    expect(mockAxiosGet).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      cached: true,
      data: [
        {
          accountId: '123',
          campaignId: 'cmp-1',
          spendUsd: 12,
          revenueD0: 24,
        },
      ],
      coverage: [{ status: 'fresh' }],
      meta: { grain: 'campaign-country-day' },
    })
  })
})
