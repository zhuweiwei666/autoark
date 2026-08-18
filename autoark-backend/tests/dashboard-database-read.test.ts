const mockAggDailyFind = jest.fn()
const mockAggCampaignAggregate = jest.fn()
const mockAggCountryAggregate = jest.fn()

jest.mock('../src/models', () => ({
  MetricsDaily: { aggregate: jest.fn() },
  Account: { countDocuments: jest.fn() },
  Campaign: { countDocuments: jest.fn() },
  Ad: { countDocuments: jest.fn() },
  SyncLog: { findOne: jest.fn(), find: jest.fn() },
  OpsLog: { find: jest.fn() },
}))

jest.mock('../src/models/Aggregation', () => ({
  AggDaily: { find: (...args: any[]) => mockAggDailyFind(...args) },
  AggCampaign: {
    aggregate: (...args: any[]) => mockAggCampaignAggregate(...args),
  },
  AggCountry: {
    aggregate: (...args: any[]) => mockAggCountryAggregate(...args),
  },
}))

import {
  getCampaignSpendRanking,
  getCoreMetrics,
  getCountrySpendRanking,
} from '../src/services/dashboard.service'

describe('legacy dashboard reads aggregation snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('builds core metrics from AggDaily and exposes partial coverage', async () => {
    mockAggDailyFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          date: '2026-08-17',
          spend: 5,
          revenue: 10,
          impressions: 50,
          clicks: 5,
          installs: 1,
          dataStatus: 'stale',
        },
        {
          date: '2026-08-18',
          spend: 7,
          revenue: 14,
          impressions: 70,
          clicks: 7,
          installs: 2,
          dataStatus: 'fresh',
        },
      ]),
    })

    const result = await getCoreMetrics('2026-08-12', '2026-08-18')

    expect(result.dataSource).toBe('database')
    expect(result.today).toMatchObject({
      spend: 7,
      available: true,
      dataStatus: 'fresh',
    })
    expect(result.yesterday).toMatchObject({ spend: 5, dataStatus: 'stale' })
    expect(result.sevenDays).toMatchObject({
      spend: 12,
      purchase_value: 24,
      coveredDays: 2,
      expectedDays: 7,
      dataStatus: 'partial',
    })
  })

  it('uses only aggregation collections for campaign and country rankings', async () => {
    mockAggCampaignAggregate.mockResolvedValue([
      { campaignId: 'cmp-1', spend: 10 },
    ])
    mockAggCountryAggregate.mockResolvedValue([{ country: 'US', spend: 10 }])

    await expect(
      getCampaignSpendRanking(5, '2026-08-12', '2026-08-18'),
    ).resolves.toEqual([{ campaignId: 'cmp-1', spend: 10 }])
    await expect(
      getCountrySpendRanking(5, '2026-08-12', '2026-08-18'),
    ).resolves.toEqual([{ country: 'US', spend: 10 }])
    expect(mockAggCampaignAggregate).toHaveBeenCalled()
    expect(mockAggCountryAggregate).toHaveBeenCalled()
  })
})
