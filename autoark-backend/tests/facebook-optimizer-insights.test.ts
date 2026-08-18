const mockFetchFacebookEdgePages = jest.fn()
const mockBulkWrite = jest.fn()
const mockDeleteMany = jest.fn()

jest.mock('../src/integration/facebook/pagination', () => ({
  fetchFacebookEdgePages: mockFetchFacebookEdgePages,
}))

jest.mock('../src/models/AdPerformanceBreakdown', () => ({
  __esModule: true,
  default: {
    bulkWrite: mockBulkWrite,
    deleteMany: mockDeleteMany,
  },
}))

import {
  collectOptimizerAccountInsights,
  normalizeOptimizerInsightRow,
} from '../src/services/facebookOptimizerInsights.service'

const account = {
  accountId: 'act_123',
  token: 'SECRET_TOKEN',
  tokenId: '665000000000000000000001',
  operator: 'buyer-a',
  organizationId: '665000000000000000000002',
  currency: 'USD',
}

describe('optimizer insight collection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBulkWrite.mockResolvedValue({})
    mockDeleteMany.mockResolvedValue({ deletedCount: 0 })
  })

  it('normalizes only the analytical fields and never persists provider payloads or tokens', () => {
    const normalized = normalizeOptimizerInsightRow({
      kind: 'placement',
      account,
      sourceSyncedAt: new Date('2026-07-27T00:00:00.000Z'),
      row: {
        date_start: '2026-07-26',
        campaign_id: 'campaign_1',
        adset_id: 'adset_1',
        ad_id: 'ad_1',
        publisher_platform: 'instagram',
        platform_position: 'reels',
        impression_device: 'iphone',
        spend: '12.50',
        impressions: '1000',
        clicks: '25',
        actions: [
          { action_type: 'offsite_conversion.fb_pixel_purchase', value: '4' },
        ],
        action_values: [
          { action_type: 'offsite_conversion.fb_pixel_purchase', value: '80' },
        ],
        raw_secret: 'must-not-survive',
      },
    })

    expect(normalized).toMatchObject({
      kind: 'placement',
      dimensionKey: 'instagram|reels|iphone',
      accountId: '123',
      currency: 'USD',
      adId: 'ad_1',
      spend: 12.5,
      purchases: 4,
      purchaseValue: 80,
      roas: 6.4,
    })
    expect(normalized).not.toHaveProperty('token')
    expect(normalized).not.toHaveProperty('actions')
    expect(normalized).not.toHaveProperty('raw')
    expect(normalized).not.toHaveProperty('raw_secret')
  })

  it('keeps country and hourly collection usable when placement collection fails', async () => {
    mockFetchFacebookEdgePages.mockImplementation(async (_endpoint, params) => {
      if (params.breakdowns.includes('publisher_platform')) {
        throw new Error('unsupported placement combination')
      }
      if (params.breakdowns === 'country') {
        return [
          {
            date_start: '2026-07-26',
            ad_id: 'ad_1',
            country: 'US',
            spend: '10',
            impressions: '100',
            clicks: '5',
            actions: [{ action_type: 'purchase', value: '2' }],
            action_values: [{ action_type: 'purchase', value: '30' }],
          },
        ]
      }
      return [
        {
          date_start: '2026-07-26',
          ad_id: 'ad_1',
          hourly_stats_aggregated_by_advertiser_time_zone:
            '20:00:00 - 20:59:59',
          spend: '4',
          impressions: '40',
          clicks: '3',
        },
      ]
    })

    const result = await collectOptimizerAccountInsights({
      account,
      window: { since: '2026-07-20', until: '2026-07-26' },
    })

    expect(result.dimensions.country).toMatchObject({
      status: 'complete',
      rows: 1,
    })
    expect(result.dimensions.placement).toMatchObject({
      status: 'failed',
      rows: 0,
      error: 'unsupported placement combination',
    })
    expect(result.dimensions.hourly).toMatchObject({
      status: 'complete',
      rows: 1,
    })
    expect(mockBulkWrite).toHaveBeenCalledTimes(2)
    expect(mockDeleteMany).toHaveBeenCalledTimes(2)
    expect(mockDeleteMany).toHaveBeenCalledWith({
      accountId: '123',
      kind: 'country',
      date: { $gte: '2026-07-20', $lte: '2026-07-26' },
      snapshotId: { $ne: expect.any(String) },
    })
    expect(mockDeleteMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'placement',
      }),
    )
    expect(mockFetchFacebookEdgePages).toHaveBeenCalledTimes(3)
    for (const call of mockFetchFacebookEdgePages.mock.calls) {
      expect(call[0]).toBe('/act_123/insights')
      expect(call[1]).toMatchObject({
        access_token: 'SECRET_TOKEN',
        level: 'ad',
        time_increment: 1,
      })
    }
  })

  it('clears stale rows when a successful dimension response is empty', async () => {
    mockFetchFacebookEdgePages.mockResolvedValue([])

    const result = await collectOptimizerAccountInsights({
      account,
      window: { since: '2026-07-20', until: '2026-07-26' },
      kinds: ['country'],
    })

    expect(result.dimensions.country).toMatchObject({
      status: 'complete',
      rows: 0,
    })
    expect(mockDeleteMany).toHaveBeenCalledWith({
      accountId: '123',
      kind: 'country',
      date: { $gte: '2026-07-20', $lte: '2026-07-26' },
    })
    expect(mockBulkWrite).not.toHaveBeenCalled()
  })

  it('keeps the previous snapshot when writing the replacement fails', async () => {
    mockFetchFacebookEdgePages.mockResolvedValue([{
      date_start: '2026-07-26',
      ad_id: 'ad_1',
      country: 'US',
      spend: '10',
    }])
    mockBulkWrite.mockRejectedValueOnce(new Error('database write failed'))

    const result = await collectOptimizerAccountInsights({
      account,
      window: { since: '2026-07-20', until: '2026-07-26' },
      kinds: ['country'],
    })

    expect(result.dimensions.country).toMatchObject({
      status: 'failed',
      rows: 0,
      error: 'database write failed',
    })
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })
})
