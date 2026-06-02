const mockCampaignFind = jest.fn()
const mockAccountFind = jest.fn()
const mockFetchInsights = jest.fn()
const mockSetToCache = jest.fn()

jest.mock('../src/models/Campaign', () => ({
  __esModule: true,
  default: {
    find: mockCampaignFind,
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: mockAccountFind,
  },
}))

jest.mock('../src/models/MetricsDaily', () => ({
  __esModule: true,
  default: {},
}))

jest.mock('../src/config/db', () => ({
  getReadConnection: jest.fn(() => require('mongoose')),
}))

jest.mock('../src/services/facebook.api', () => ({
  fetchCampaigns: jest.fn(),
  fetchInsights: mockFetchInsights,
}))

jest.mock('../src/utils/cache', () => ({
  getFromCache: jest.fn(),
  setToCache: mockSetToCache,
  getCacheKey: jest.fn(() => 'campaign-metrics-cache-key'),
  CACHE_TTL: {
    TODAY: 60,
    DATE_RANGE: 300,
  },
}))

import { getCampaigns } from '../src/services/facebook.campaigns.service'

const leanQuery = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const selectLeanQuery = (value: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
})

const campaigns = [
  { campaignId: 'camp_1', accountId: '123', name: 'Campaign 1', createdAt: new Date('2026-06-01T00:00:00.000Z') },
  { campaignId: 'camp_2', accountId: '456', name: 'Campaign 2', createdAt: new Date('2026-06-01T00:00:00.000Z') },
]

describe('facebook campaign insights token scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCampaignFind.mockReturnValue(leanQuery(campaigns))
    mockAccountFind.mockReturnValue(selectLeanQuery([
      { accountId: '123', token: 'token-account-123' },
      { accountId: '456', token: 'token-account-456' },
    ]))
    mockFetchInsights.mockImplementation(async (accountId: string) => [{
      campaign_id: accountId === 'act_123' ? 'camp_1' : 'camp_2',
      spend: accountId === 'act_123' ? '10' : '20',
      impressions: '1000',
      clicks: '50',
      action_values: [{ action_type: 'omni_purchase', value: '25' }],
    }])
  })

  it('uses each account stored token when sorting campaigns by live metrics', async () => {
    const result = await getCampaigns(
      {},
      { page: 1, limit: 20, sortBy: 'spend', sortOrder: 'desc' },
    )

    expect(mockAccountFind).toHaveBeenCalledWith({
      accountId: { $in: expect.arrayContaining(['123', 'act_123', '456', 'act_456']) },
    })
    expect(mockFetchInsights).toHaveBeenCalledWith(
      'act_123',
      'campaign',
      'today',
      'token-account-123',
      undefined,
      undefined,
    )
    expect(mockFetchInsights).toHaveBeenCalledWith(
      'act_456',
      'campaign',
      'today',
      'token-account-456',
      undefined,
      undefined,
    )
    expect(result.data.map((campaign: any) => campaign.id)).toEqual(['camp_2', 'camp_1'])
  })

  it('uses each account stored token when enriching a campaign page with live metrics', async () => {
    const result = await getCampaigns(
      {},
      { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' },
    )

    expect(mockAccountFind).toHaveBeenCalledWith({
      accountId: { $in: expect.arrayContaining(['123', 'act_123', '456', 'act_456']) },
    })
    expect(mockFetchInsights).toHaveBeenCalledWith(
      'act_123',
      'campaign',
      'today',
      'token-account-123',
      undefined,
      undefined,
    )
    expect(mockFetchInsights).toHaveBeenCalledWith(
      'act_456',
      'campaign',
      'today',
      'token-account-456',
      undefined,
      undefined,
    )
    expect(mockSetToCache).toHaveBeenCalledWith('campaign-metrics-cache-key', expect.any(Array), 60)
    expect(result.data).toHaveLength(2)
  })
})
