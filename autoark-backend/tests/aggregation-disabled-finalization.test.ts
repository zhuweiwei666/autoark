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
const mockCountryAccountBulkWrite = jest.fn()
const mockCachedAccountLean = jest.fn()
const mockCachedCountryLean = jest.fn()
const mockCachedCampaignLean = jest.fn()
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
  AggCountryAccount: {
    bulkWrite: (...args: any[]) => mockCountryAccountBulkWrite(...args),
    find: jest.fn(() => ({ lean: mockCachedCountryLean })),
  },
  AggAccount: {
    distinct: (...args: any[]) => mockPreviouslyAggregatedAccountIds(...args),
    bulkWrite: jest.fn(),
    findOne: jest.fn(() => ({ lean: mockCachedAccountLean })),
  },
  AggCampaign: {
    bulkWrite: jest.fn(),
    find: jest.fn(() => ({ lean: mockCachedCampaignLean })),
  },
  AggOptimizer: { bulkWrite: jest.fn() },
  isRecentDate: jest.fn(() => true),
}))

jest.mock('../src/integration/facebook/insights.api', () => ({
  fetchInsights: (...args: any[]) => mockFetchInsights(...args),
}))

jest.mock('../src/services/metaBusinessCredential.service', () => ({
  resolveAccountOperationalAuthorizations: (...args: any[]) =>
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
    mockResolveAccountOperationalAuthorization.mockResolvedValue([{
      token: 'TOKEN_A',
    }])
    mockCachedAccountLean.mockResolvedValue(null)
    mockCachedCountryLean.mockResolvedValue([])
    mockCachedCampaignLean.mockResolvedValue([])
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
          status: { $in: ['disabled', 'unsettled', 'review', 'closed'] },
          insightsFinalizationUntil: { $exists: false },
          sourceSyncedAt: {
            $gte: new Date('2026-07-24T08:00:00.000Z'),
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

  it('persists country metrics by account for scoped country summaries', async () => {
    mockPreviouslyAggregatedAccountIds.mockResolvedValue([])
    mockAccountFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          accountId: '101',
          organizationId: 'org-1',
          status: 'active',
          name: 'Account 101',
        },
      ]),
    })
    mockFetchInsights.mockResolvedValue([
      {
        campaign_id: 'cmp-1',
        campaign_name: 'alice_campaign',
        country: 'US',
        spend: '12.34',
        impressions: '1000',
        clicks: '50',
        actions: [{ action_type: 'mobile_app_install', value: '4' }],
        action_values: [{ action_type: 'purchase', value: '24.68' }],
      },
    ])

    await refreshAggregation('2026-07-27')

    expect(mockCountryAccountBulkWrite).toHaveBeenCalledTimes(1)
    expect(mockCountryAccountBulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: {
            date: '2026-07-27',
            accountId: '101',
            country: 'US',
          },
          update: expect.objectContaining({
            date: '2026-07-27',
            accountId: '101',
            country: 'US',
            countryName: '美国',
            spend: 12.34,
            revenue: 24.68,
            campaigns: 1,
          }),
          upsert: true,
        }),
      }),
      {
        deleteMany: {
          filter: {
            date: '2026-07-27',
            accountId: '101',
            country: { $nin: ['US'] },
          },
        },
      },
    ])
  })

  it('tries the personal fallback and keeps the cached snapshot when both authorizations fail', async () => {
    mockPreviouslyAggregatedAccountIds.mockResolvedValue(['101'])
    mockAccountFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{
        accountId: '101',
        organizationId: 'org-1',
        status: 'disabled',
      }]),
    })
    mockResolveAccountOperationalAuthorization.mockResolvedValue([
      { authorizationType: 'system_user', token: 'SYSTEM_TOKEN' },
      { authorizationType: 'personal', token: 'PERSONAL_TOKEN' },
    ])
    mockFetchInsights.mockRejectedValue(new Error('account disabled'))
    mockCachedAccountLean.mockResolvedValue({
      accountId: '101',
      spend: 12.34,
      revenue: 24.68,
      impressions: 1000,
      clicks: 50,
      installs: 4,
      campaigns: 1,
    })
    mockCachedCountryLean.mockResolvedValue([{
      country: 'US',
      countryName: '美国',
      spend: 12.34,
      revenue: 24.68,
      impressions: 1000,
      clicks: 50,
      installs: 4,
      campaigns: 1,
    }])
    mockCachedCampaignLean.mockResolvedValue([{
      campaignId: 'cmp-1',
      campaignName: 'alice_campaign',
      accountId: '101',
      accountName: 'Account 101',
      optimizer: 'alice',
      spend: 12.34,
      revenue: 24.68,
      impressions: 1000,
      clicks: 50,
      installs: 4,
      status: 'ACTIVE',
    }])

    await refreshAggregation('2026-07-27')

    expect(mockFetchInsights).toHaveBeenCalledTimes(2)
    expect(mockDailyUpsert).toHaveBeenCalledWith(
      { date: '2026-07-27' },
      expect.objectContaining({
        spend: 12.34,
        revenue: 24.68,
        activeAccounts: 1,
        activeCampaigns: 1,
        dataStatus: 'stale',
        failedAccounts: 1,
        cachedAccounts: 1,
      }),
      { upsert: true },
    )
  })
})
