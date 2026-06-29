const mockFetchCampaigns = jest.fn()
const mockFetchInsights = jest.fn()

jest.mock('../src/services/facebook.api', () => ({
  fetchCampaigns: mockFetchCampaigns,
  fetchInsights: mockFetchInsights,
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}))

jest.mock('../src/models/Campaign', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: jest.fn(),
  },
}))

jest.mock('../src/models/MetricsDaily', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: jest.fn(),
  },
}))

import Account from '../src/models/Account'
import Campaign from '../src/models/Campaign'
import MetricsDaily from '../src/models/MetricsDaily'
import { syncCampaignsFromAdAccounts } from '../src/services/facebook.campaigns.service'

describe('facebook campaign sync channel scope', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('upserts campaigns with a facebook channel filter', async () => {
    ;(Account.find as jest.Mock).mockResolvedValue([{
      accountId: '123',
      token: 'TOKEN_A',
      status: 'active',
    }])
    mockFetchCampaigns.mockResolvedValue([{
      id: 'camp_1',
      name: 'Campaign 1',
      status: 'ACTIVE',
      objective: 'SALES',
    }])
    mockFetchInsights.mockResolvedValue([])
    ;(Campaign.findOneAndUpdate as jest.Mock).mockResolvedValue({} as any)

    const result = await syncCampaignsFromAdAccounts()

    expect(mockFetchCampaigns).toHaveBeenCalledWith('act_123', 'TOKEN_A')
    expect(Campaign.findOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'facebook', campaignId: 'camp_1' },
      expect.objectContaining({
        channel: 'facebook',
        campaignId: 'camp_1',
        accountId: '123',
      }),
      { upsert: true, new: true },
    )
    expect(MetricsDaily.findOneAndUpdate).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      syncedCampaigns: 1,
      syncedMetrics: 0,
      errorCount: 0,
    })
  })
})
