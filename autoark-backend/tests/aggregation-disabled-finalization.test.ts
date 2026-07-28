const mockAccountFind = jest.fn()
const mockCampaignLean = jest.fn()
const mockCampaignSelect = jest.fn(() => ({ lean: mockCampaignLean }))
const mockCampaignFind = jest.fn(() => ({ select: mockCampaignSelect }))
const mockTokenLean = jest.fn()
const mockTokenFind = jest.fn(() => ({ lean: mockTokenLean }))
const mockDailyUpsert = jest.fn()
const mockPreviouslyAggregatedAccountIds = jest.fn()
const mockFetchInsights = jest.fn()
const mockResolveAccountOperationalAuthorization = jest.fn()
const originalAggregationConcurrency =
  process.env.FACEBOOK_AGGREGATION_CONCURRENCY

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockAccountFind(...args),
  },
}))

jest.mock('../src/models/Campaign', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockCampaignFind(...args),
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockTokenFind(...args),
  },
}))

jest.mock('../src/models/Aggregation', () => ({
  AggDaily: {
    findOneAndUpdate: (...args: any[]) => mockDailyUpsert(...args),
  },
  AggCountry: { bulkWrite: jest.fn() },
  AggAccount: {
    distinct: (...args: any[]) => mockPreviouslyAggregatedAccountIds(...args),
    bulkWrite: jest.fn(),
  },
  AggCampaign: { bulkWrite: jest.fn() },
  AggOptimizer: { bulkWrite: jest.fn() },
  isRecentDate: jest.fn(() => true),
}))

jest.mock('../src/integration/facebook/insights.api', () => ({
  fetchInsights: (...args: any[]) => mockFetchInsights(...args),
}))

jest.mock('../src/services/metaBusinessCredential.service', () => ({
  resolveAccountOperationalAuthorization: (...args: any[]) =>
    mockResolveAccountOperationalAuthorization(...args),
}))

import { refreshAggregation } from '../src/services/aggregation.service'

describe('aggregation account eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T08:00:00.000Z'))
    mockTokenLean.mockResolvedValue([{ token: 'TOKEN_A' }])
    mockAccountFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    mockCampaignLean.mockResolvedValue([])
    mockDailyUpsert.mockResolvedValue({})
    mockPreviouslyAggregatedAccountIds.mockResolvedValue(['123'])
    mockFetchInsights.mockResolvedValue([])
    mockResolveAccountOperationalAuthorization.mockResolvedValue({
      token: 'TOKEN_A',
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    if (originalAggregationConcurrency === undefined) {
      delete process.env.FACEBOOK_AGGREGATION_CONCURRENCY
    } else {
      process.env.FACEBOOK_AGGREGATION_CONCURRENCY =
        originalAggregationConcurrency
    }
  })

  it('refreshes active, finalizing, and already aggregated accounts for the exact date', async () => {
    await refreshAggregation('2026-07-27')

    expect(mockPreviouslyAggregatedAccountIds).toHaveBeenCalledWith(
      'accountId',
      {
        date: '2026-07-27',
      },
    )
    expect(mockAccountFind).toHaveBeenCalledWith({
      channel: 'facebook',
      $or: [
        { status: 'active' },
        {
          insightsFinalizationUntil: {
            $gte: new Date('2026-07-27T08:00:00.000Z'),
          },
        },
        {
          accountId: {
            $in: ['123'],
          },
        },
      ],
    })
  })

  it('limits concurrent Meta insights requests to the configured bound', async () => {
    process.env.FACEBOOK_AGGREGATION_CONCURRENCY = '2'
    mockPreviouslyAggregatedAccountIds.mockResolvedValue([])
    mockAccountFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          accountId: '101',
          organizationId: 'org-1',
          status: 'active',
        },
        {
          accountId: '102',
          organizationId: 'org-1',
          status: 'active',
        },
        {
          accountId: '103',
          organizationId: 'org-1',
          status: 'active',
        },
      ]),
    })

    const releases: Array<() => void> = []
    mockFetchInsights.mockImplementation(
      () =>
        new Promise<any[]>((resolve) => {
          releases.push(() => resolve([]))
        }),
    )

    const refresh = refreshAggregation('2026-07-27')
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    expect(mockFetchInsights).toHaveBeenCalledTimes(2)

    releases[0]()
    releases[1]()
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    expect(mockFetchInsights).toHaveBeenCalledTimes(3)

    releases[2]()
    await refresh
  })
})
