import express from 'express'
import request from 'supertest'

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}))

jest.mock('../src/models/Aggregation', () => ({
  AggAccount: {
    aggregate: jest.fn(),
    distinct: jest.fn(),
    findOne: jest.fn(),
  },
  AggCampaign: {
    aggregate: jest.fn(),
    distinct: jest.fn(),
    findOne: jest.fn(),
  },
  AggCountryAccount: {
    aggregate: jest.fn(),
    distinct: jest.fn(),
    findOne: jest.fn(),
  },
}))

import aiAdsIntegrationRoutes from '../src/routes/aiAdsIntegration.routes'
import { parseCampaignDeliveryName } from '../src/services/aiAdsIntegration.service'
import FbToken from '../src/models/FbToken'
import Account from '../src/models/Account'
import {
  AggAccount,
  AggCampaign,
  AggCountryAccount,
} from '../src/models/Aggregation'

const API_KEY = 'unit-test-ai-ads-key'
const ORGANIZATION_ID = '6a66f1c7b8d8834d4a08e68d'

const chainResult = (value: unknown) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
})

const freshnessResult = (value: unknown) => ({
  sort: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
  }),
})

const createApp = () => {
  const app = express()
  app.use('/api/integrations/ai-ads', aiAdsIntegrationRoutes)
  return app
}

const authorize = (path: string) =>
  request(createApp()).get(path).set('Authorization', `Bearer ${API_KEY}`)

describe('AI ads read integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AI_ADS_INTEGRATION_API_KEY = API_KEY
    process.env.AI_ADS_INTEGRATION_ORGANIZATION_ID = ORGANIZATION_ID
    ;(FbToken.find as jest.Mock).mockReturnValue(
      chainResult([{ _id: 'token-id-1', token: 'meta-token-must-not-leak' }]),
    )
    ;(Account.find as jest.Mock).mockReturnValue(
      chainResult([
        { accountId: 'act_123', currency: 'USD' },
        { accountId: '456', currency: 'USD' },
      ]),
    )
    ;(AggAccount.distinct as jest.Mock).mockResolvedValue(['123', '456'])
    ;(AggCampaign.distinct as jest.Mock).mockResolvedValue(['123', '456'])
    ;(AggCountryAccount.distinct as jest.Mock).mockResolvedValue(['123', '456'])
  })

  afterAll(() => {
    delete process.env.AI_ADS_INTEGRATION_API_KEY
    delete process.env.AI_ADS_INTEGRATION_ORGANIZATION_ID
  })

  it('fails closed when service configuration is absent', async () => {
    delete process.env.AI_ADS_INTEGRATION_API_KEY

    const response = await request(createApp())
      .get('/api/integrations/ai-ads')
      .set('Authorization', `Bearer ${API_KEY}`)

    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      success: false,
      error: 'AI ads integration is not configured',
    })
    expect(FbToken.find).not.toHaveBeenCalled()
  })

  it('rejects missing or incorrect bearer credentials', async () => {
    const missing = await request(createApp()).get('/api/integrations/ai-ads')
    const incorrect = await request(createApp())
      .get('/api/integrations/ai-ads')
      .set('Authorization', 'Bearer wrong-key')

    expect(missing.status).toBe(401)
    expect(incorrect.status).toBe(401)
    expect(FbToken.find).not.toHaveBeenCalled()
  })

  it('rejects invalid dimensions and date ranges before database access', async () => {
    const invalidDimension = await authorize(
      '/api/integrations/ai-ads?dimension=token',
    )
    const excessiveRange = await authorize(
      '/api/integrations/ai-ads?startDate=2026-01-01&endDate=2026-07-31',
    )
    const invalidDate = await authorize(
      '/api/integrations/ai-ads?startDate=2026-02-30',
    )

    expect(invalidDimension.status).toBe(400)
    expect(excessiveRange.status).toBe(400)
    expect(invalidDate.status).toBe(400)
    expect(FbToken.find).not.toHaveBeenCalled()
  })

  it('rejects mixed-currency totals unless the caller selects one currency', async () => {
    ;(Account.find as jest.Mock).mockReturnValue(
      chainResult([
        { accountId: '123', currency: 'USD' },
        { accountId: '456', currency: 'EUR' },
      ]),
    )

    const mixed = await authorize('/api/integrations/ai-ads?dimension=overview')

    expect(mixed.status).toBe(400)
    expect(mixed.body.error).toContain('specify currency')
    expect(AggAccount.aggregate).not.toHaveBeenCalled()
  })

  it('returns country metrics only for the server-configured organization scope', async () => {
    ;(AggCountryAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [
          {
            country: 'US',
            spend: 12,
            revenue: 24,
            purchase_value: 24,
            roas: 2,
          },
        ],
        total: [{ count: 1 }],
      },
    ])
    ;(AggCountryAccount.findOne as jest.Mock).mockReturnValue(
      freshnessResult({
        date: '2026-07-31',
        updatedAt: new Date('2026-07-31T12:00:00Z'),
      }),
    )

    const response = await authorize(
      '/api/integrations/ai-ads' +
        '?dimension=country' +
        '&startDate=2026-07-31' +
        '&endDate=2026-07-31' +
        '&organizationId=attacker-controlled' +
        '&accountId=999' +
        '&limit=1000',
    )

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([
      expect.objectContaining({
        country: 'US',
        spend: 12,
        purchase_value: 24,
      }),
    ])
    expect(response.body.meta).toMatchObject({
      scope: 'gaoyuhua',
      metricDefinitions: { currency: 'USD' },
      coverage: {
        scopedAccounts: 2,
        coveredAccounts: 2,
        missingAccounts: 0,
        returnedRows: 1,
      },
      pagination: { page: 1, limit: 100, total: 1, pages: 1 },
    })
    expect(FbToken.find).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      status: 'active',
    })
    expect(Account.find).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'facebook',
        $or: expect.arrayContaining([
          { organizationId: ORGANIZATION_ID },
          {
            organizationId: null,
            tokenId: { $in: ['token-id-1'] },
          },
          {
            organizationId: null,
            token: { $in: ['meta-token-must-not-leak'] },
          },
        ]),
      }),
    )
    const match = (AggCountryAccount.aggregate as jest.Mock).mock.calls[0][0][0]
      .$match
    expect(match.accountId.$in).toEqual(
      expect.arrayContaining(['123', 'act_123', '456', 'act_456']),
    )
    expect(JSON.stringify(response.body)).not.toContain(
      'meta-token-must-not-leak',
    )
    expect(JSON.stringify(response.body)).not.toContain(ORGANIZATION_ID)
  })

  it('returns a safe overview with distinct active account and campaign counts', async () => {
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        spend: 100,
        revenue: 250,
        purchase_value: 250,
        roas: 2.5,
        impressions: 1000,
        clicks: 100,
        installs: 20,
        ctr: 0.1,
        cpc: 1,
        cpm: 100,
        cpi: 5,
      },
    ])
    ;(AggAccount.distinct as jest.Mock).mockResolvedValue(['123', '456'])
    ;(AggCampaign.distinct as jest.Mock).mockResolvedValue([
      'cmp-1',
      'cmp-2',
      'cmp-3',
    ])
    ;(AggAccount.findOne as jest.Mock).mockReturnValue(
      freshnessResult({ date: '2026-07-31', updatedAt: new Date() }),
    )

    const response = await authorize(
      '/api/integrations/ai-ads' +
        '?dimension=overview' +
        '&startDate=2026-07-31' +
        '&endDate=2026-07-31',
    )

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      spend: 100,
      purchase_value: 250,
      roas: 2.5,
      currency: 'USD',
      activeAccounts: 2,
      activeCampaigns: 3,
    })
    expect(response.body.meta.coverage).toMatchObject({
      scopedAccounts: 2,
      coveredAccounts: 2,
      missingAccounts: 0,
    })
    expect(response.body.meta.freshness.complete).toBe(true)
    expect(response.body.meta).not.toHaveProperty('pagination')
  })

  it('returns account and campaign dimensions with bounded pagination', async () => {
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [
          {
            accountId: '123',
            accountName: 'AI product account',
            spend: 40,
            purchase_value: 80,
            roas: 2,
          },
        ],
        total: [{ count: 2 }],
      },
    ])
    ;(AggAccount.findOne as jest.Mock).mockReturnValue(
      freshnessResult({ date: '2026-07-31', updatedAt: new Date() }),
    )

    const accountResponse = await authorize(
      '/api/integrations/ai-ads' +
        '?dimension=account' +
        '&startDate=2026-07-31' +
        '&endDate=2026-07-31' +
        '&page=999999999999999999999' +
        '&limit=999',
    )

    expect(accountResponse.status).toBe(200)
    expect(accountResponse.body.data[0]).toMatchObject({
      accountId: '123',
      spend: 40,
      purchase_value: 80,
    })
    expect(accountResponse.body.meta.pagination).toMatchObject({
      page: 100,
      limit: 100,
      total: 2,
      pages: 1,
    })
    ;(AggCampaign.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [
          {
            campaignId: 'cmp-1',
            campaignName: 'cq2-US-video',
            accountId: '123',
            optimizer: 'cq2',
            spend: 15,
            purchase_value: 0,
            roas: 0,
          },
        ],
        total: [{ count: 1 }],
      },
    ])
    ;(AggCampaign.findOne as jest.Mock).mockReturnValue(
      freshnessResult({ date: '2026-07-31', updatedAt: new Date() }),
    )

    const campaignResponse = await authorize(
      '/api/integrations/ai-ads' +
        '?dimension=campaign' +
        '&startDate=2026-07-31' +
        '&endDate=2026-07-31',
    )

    expect(campaignResponse.status).toBe(200)
    expect(campaignResponse.body.data[0]).toMatchObject({
      campaignId: 'cmp-1',
      accountId: '123',
      optimizer: 'cq2',
      spend: 15,
      purchase_value: 0,
    })
    const campaignMatch = (AggCampaign.aggregate as jest.Mock).mock
      .calls[0][0][0].$match
    expect(campaignMatch.accountId.$in).toEqual(
      expect.arrayContaining(['123', 'act_123', '456', 'act_456']),
    )
  })

  it('parses the campaign naming contract into operator, channel, product, and client end', () => {
    expect(parseCampaignDeliveryName('gyh_fb_clingai_web_launch_01')).toEqual({
      optimizer: 'gyh',
      channel: 'facebook_ads',
      product: 'clingai',
      platform: 'web',
      matched: true,
    })
    expect(parseCampaignDeliveryName('GYH_META_CLINGAI_APK_launch')).toEqual({
      optimizer: 'gyh',
      channel: 'facebook_ads',
      product: 'clingai',
      platform: 'android',
      matched: true,
    })
    expect(parseCampaignDeliveryName('legacy-campaign-name')).toEqual({
      optimizer: 'unknown',
      channel: 'other',
      product: 'unknown',
      platform: 'all',
      matched: false,
    })
  })

  it('returns daily delivery rows already parsed and grouped for ROI consumers', async () => {
    ;(AggCampaign.aggregate as jest.Mock).mockResolvedValueOnce([
      {
        date: '2026-07-31',
        campaignId: 'cmp-1',
        campaignName: 'gyh_fb_clingai_web_launch_01',
        optimizer: 'gyh',
        spend: 40,
        revenue: 80,
        impressions: 400,
        clicks: 40,
        installs: 4,
      },
      {
        date: '2026-07-31',
        campaignId: 'cmp-2',
        campaignName: 'gyh_fb_clingai_web_launch_02',
        optimizer: 'gyh',
        spend: 60,
        revenue: 120,
        impressions: 600,
        clicks: 60,
        installs: 6,
      },
      {
        date: '2026-07-31',
        campaignId: 'cmp-3',
        campaignName: 'legacy-campaign-name',
        optimizer: 'unknown',
        spend: 5,
        revenue: 0,
        impressions: 50,
        clicks: 5,
        installs: 0,
      },
    ])
    ;(AggCampaign.findOne as jest.Mock).mockReturnValue(
      freshnessResult({ date: '2026-07-31', updatedAt: new Date() }),
    )

    const response = await authorize(
      '/api/integrations/ai-ads' +
        '?dimension=delivery' +
        '&startDate=2026-07-31' +
        '&endDate=2026-07-31',
    )

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: '2026-07-31',
          optimizer: 'gyh',
          channel: 'facebook_ads',
          product: 'clingai',
          platform: 'web',
          spend: 100,
          impressions: 1000,
          clicks: 100,
          installs: 10,
          campaigns: 2,
        }),
        expect.objectContaining({
          channel: 'other',
          product: 'unknown',
          platform: 'all',
          spend: 5,
          namingMatched: false,
        }),
      ]),
    )
    expect(response.body.meta).toMatchObject({
      dimension: 'delivery',
      namingContract: {
        version: 1,
        pattern: '<optimizer>_<channel>_<product>_<platform>_*',
      },
      pagination: { page: 1, limit: 50, total: 2, pages: 1 },
    })
  })
})
