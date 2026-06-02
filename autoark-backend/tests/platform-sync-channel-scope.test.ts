const mockFetchCampaigns = jest.fn()
const mockFetchAdSets = jest.fn()
const mockFetchAds = jest.fn()
const mockFetchCreatives = jest.fn()
const mockFetchInsights = jest.fn()

const mockFetchTiktokCampaigns = jest.fn()
const mockFetchTiktokAdGroups = jest.fn()
const mockFetchTiktokAds = jest.fn()
const mockFetchTiktokInsights = jest.fn()

const mockCampaignFindOneAndUpdate = jest.fn()
const mockAdSetFindOneAndUpdate = jest.fn()
const mockAdFindOneAndUpdate = jest.fn()
const mockCreativeFindOneAndUpdate = jest.fn()
const mockMetricsFindOneAndUpdate = jest.fn()

jest.mock('../src/services/facebook.api', () => ({
  fetchCampaigns: mockFetchCampaigns,
  fetchAdSets: mockFetchAdSets,
  fetchAds: mockFetchAds,
  fetchCreatives: mockFetchCreatives,
  fetchInsights: mockFetchInsights,
}))

jest.mock('../src/integration/tiktok/insights.api', () => ({
  fetchTiktokCampaigns: mockFetchTiktokCampaigns,
  fetchTiktokAdGroups: mockFetchTiktokAdGroups,
  fetchTiktokAds: mockFetchTiktokAds,
  fetchTiktokInsights: mockFetchTiktokInsights,
}))

jest.mock('../src/models', () => ({
  Campaign: { findOneAndUpdate: mockCampaignFindOneAndUpdate },
  AdSet: { findOneAndUpdate: mockAdSetFindOneAndUpdate },
  Ad: { findOneAndUpdate: mockAdFindOneAndUpdate },
  Creative: { findOneAndUpdate: mockCreativeFindOneAndUpdate },
  MetricsDaily: { findOneAndUpdate: mockMetricsFindOneAndUpdate },
  SyncLog: jest.fn(),
  TiktokToken: { find: jest.fn() },
}))

import { syncAccount } from '../src/services/facebook.sync.service'
import { syncTiktokAdvertiser } from '../src/services/tiktok.sync.service'

describe('platform sync channel-scoped upserts', () => {
  beforeEach(() => {
    mockCampaignFindOneAndUpdate.mockResolvedValue({})
    mockAdSetFindOneAndUpdate.mockResolvedValue({})
    mockAdFindOneAndUpdate.mockResolvedValue({})
    mockCreativeFindOneAndUpdate.mockResolvedValue({})
    mockMetricsFindOneAndUpdate.mockResolvedValue({})
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('uses channel in legacy Facebook asset and metrics upsert filters', async () => {
    mockFetchCampaigns.mockResolvedValueOnce([
      { id: 'camp_1', name: 'Campaign', status: 'ACTIVE', objective: 'SALES' },
    ])
    mockFetchAdSets.mockResolvedValueOnce([
      { id: 'adset_1', campaign_id: 'camp_1', name: 'AdSet', status: 'ACTIVE' },
    ])
    mockFetchAds.mockResolvedValueOnce([
      { id: 'ad_1', adset_id: 'adset_1', campaign_id: 'camp_1', name: 'Ad', status: 'ACTIVE', creative: { id: 'creative_1' } },
    ])
    mockFetchCreatives.mockResolvedValueOnce([
      { id: 'creative_1', name: 'Creative', status: 'ACTIVE', image_hash: 'hash_1' },
    ])
    mockFetchInsights
      .mockResolvedValueOnce([
        {
          date_start: '2026-06-02',
          campaign_id: 'camp_1',
          country: 'US',
          spend: '10',
          impressions: '1000',
          clicks: '50',
          actions: [{ action_type: 'mobile_app_install', value: '3' }],
          action_values: [{ action_type: 'omni_purchase', value: '25' }],
        },
      ])
      .mockResolvedValueOnce([
        {
          date_start: '2026-06-02',
          campaign_id: 'camp_1',
          adset_id: 'adset_1',
          ad_id: 'ad_1',
          country: 'US',
          spend: '5',
          impressions: '500',
          clicks: '20',
          actions: [],
          action_values: [],
        },
      ])

    await syncAccount('act_123')

    expect(mockCampaignFindOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'facebook', campaignId: 'camp_1' },
      expect.objectContaining({ channel: 'facebook', platform: 'facebook', accountId: '123' }),
      expect.any(Object),
    )
    expect(mockAdSetFindOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'facebook', adsetId: 'adset_1' },
      expect.objectContaining({ channel: 'facebook', platform: 'facebook', accountId: '123' }),
      expect.any(Object),
    )
    expect(mockAdFindOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'facebook', adId: 'ad_1' },
      expect.objectContaining({ channel: 'facebook', platform: 'facebook', accountId: '123' }),
      expect.any(Object),
    )
    expect(mockCreativeFindOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'facebook', creativeId: 'creative_1' },
      expect.objectContaining({ channel: 'facebook', accountId: '123' }),
      expect.any(Object),
    )
    expect(mockMetricsFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'facebook', date: '2026-06-02', level: 'campaign', entityId: 'camp_1' }),
      expect.objectContaining({ channel: 'facebook', accountId: '123' }),
      expect.any(Object),
    )
  })

  it('uses channel in TikTok asset upsert filters', async () => {
    mockFetchTiktokCampaigns.mockResolvedValueOnce({
      list: [{ campaign_id: 'tk_camp_1', campaign_name: 'TikTok Campaign', operation_status: 'ENABLE', objective_type: 'TRAFFIC' }],
    })
    mockFetchTiktokAdGroups.mockResolvedValueOnce({
      list: [{ adgroup_id: 'tk_adgroup_1', campaign_id: 'tk_camp_1', adgroup_name: 'TikTok AdGroup', operation_status: 'ENABLE' }],
    })
    mockFetchTiktokAds.mockResolvedValueOnce({
      list: [{ ad_id: 'tk_ad_1', adgroup_id: 'tk_adgroup_1', campaign_id: 'tk_camp_1', ad_name: 'TikTok Ad', operation_status: 'ENABLE' }],
    })
    mockFetchTiktokInsights.mockResolvedValueOnce({
      list: [{
        dimensions: { stat_time_hour: '2026-06-02 10:00:00', ad_id: 'tk_ad_1' },
        metrics: { spend: '8', impressions: '800', clicks: '40', conversions: '2', purchase: '12' },
      }],
    })

    await syncTiktokAdvertiser('adv_1', 'TIKTOK_TOKEN')

    expect(mockCampaignFindOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'tiktok', campaignId: 'tk_camp_1' },
      expect.objectContaining({ channel: 'tiktok', platform: 'tiktok', accountId: 'adv_1' }),
      expect.any(Object),
    )
    expect(mockAdSetFindOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'tiktok', adsetId: 'tk_adgroup_1' },
      expect.objectContaining({ channel: 'tiktok', platform: 'tiktok', accountId: 'adv_1' }),
      expect.any(Object),
    )
    expect(mockAdFindOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'tiktok', adId: 'tk_ad_1' },
      expect.objectContaining({ channel: 'tiktok', platform: 'tiktok', accountId: 'adv_1' }),
      expect.any(Object),
    )
    expect(mockMetricsFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'tiktok', date: '2026-06-02', level: 'ad', entityId: 'tk_ad_1' }),
      expect.objectContaining({ channel: 'tiktok', accountId: 'adv_1' }),
      expect.any(Object),
    )
  })
})
