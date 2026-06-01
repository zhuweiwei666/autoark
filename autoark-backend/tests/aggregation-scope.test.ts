import express from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

const mockAuthState: { user: any } = { user: null }
const mockCampaignLean = jest.fn()
const mockCampaignSort = jest.fn(() => ({ lean: mockCampaignLean }))
const mockCampaignFind = jest.fn(() => ({ sort: mockCampaignSort }))

jest.mock('../src/middlewares/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = mockAuthState.user
    next()
  },
  getUserAccountIds: jest.fn(),
}))

jest.mock('../src/services/aggregation.service', () => ({
  getDailySummary: jest.fn(),
  getCountryData: jest.fn(),
  getAccountData: jest.fn(),
  getCampaignData: jest.fn(),
  getOptimizerData: jest.fn(),
  getMaterialData: jest.fn(),
  refreshRecentDays: jest.fn(),
  refreshAggregation: jest.fn(),
}))

jest.mock('../src/models/Aggregation', () => ({
  AggDaily: {
    find: jest.fn(),
  },
  AggCountry: {
    find: jest.fn(),
    aggregate: jest.fn(),
  },
  AggAccount: {
    find: jest.fn(),
  },
  AggCampaign: {
    find: (...args: any[]) => mockCampaignFind(...args),
  },
  AggOptimizer: {
    find: jest.fn(),
    aggregate: jest.fn(),
  },
}))

jest.mock('../src/models/MaterialMetrics', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}))

import aggregationRouter from '../src/controllers/aggregation.controller'
import { getUserAccountIds } from '../src/middlewares/auth'

const createApp = () => {
  const app = express()
  app.use('/api/agg', aggregationRouter)
  return app
}

describe('aggregation route account scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }
    mockCampaignLean.mockResolvedValue([{ campaignId: 'cmp_1', accountId: '123', spend: 42 }])
  })

  afterEach(() => {
    mockAuthState.user = null
  })

  it('matches campaign account filters across act_ account id formats', async () => {
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['123'])

    const response = await request(createApp()).get('/api/agg/campaigns?date=2026-06-02&accountId=act_123')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([{ campaignId: 'cmp_1', accountId: '123', spend: 42 }])
    expect(mockCampaignFind).toHaveBeenCalledWith({
      date: '2026-06-02',
      accountId: { $in: ['123', 'act_123'] },
    })
  })

  it('returns empty results when filtered account is outside the user scope', async () => {
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['123'])

    const response = await request(createApp()).get('/api/agg/campaigns?date=2026-06-02&accountId=act_999')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      success: true,
      data: [],
      meta: { date: '2026-06-02', count: 0 },
    })
    expect(mockCampaignFind).not.toHaveBeenCalled()
  })
})
