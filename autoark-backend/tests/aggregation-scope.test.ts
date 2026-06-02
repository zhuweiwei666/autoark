import express from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

const mockAuthState: { user: any } = { user: null }
const mockCampaignLean = jest.fn()
const mockCampaignLimit = jest.fn(() => ({ lean: mockCampaignLean }))
const mockCampaignSort = jest.fn(() => ({ limit: mockCampaignLimit, lean: mockCampaignLean }))
const mockCampaignFind = jest.fn(() => ({ sort: mockCampaignSort }))
const mockCampaignAggregate = jest.fn()
const mockOptimizerLean = jest.fn()
const mockOptimizerLimit = jest.fn(() => ({ lean: mockOptimizerLean }))
const mockOptimizerSort = jest.fn(() => ({ limit: mockOptimizerLimit, lean: mockOptimizerLean }))
const mockOptimizerFind = jest.fn(() => ({ sort: mockOptimizerSort }))

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
    aggregate: (...args: any[]) => mockCampaignAggregate(...args),
  },
  AggOptimizer: {
    find: (...args: any[]) => mockOptimizerFind(...args),
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
import { getDailySummary } from '../src/services/aggregation.service'

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
    mockOptimizerLean.mockResolvedValue([{ optimizer: 'alice', spend: 42 }])
    mockCampaignAggregate.mockResolvedValue([{ optimizer: 'alice', spend: 42 }])
  })

  afterEach(() => {
    mockAuthState.user = null
  })

  it('matches campaign account filters across act_ account id formats', async () => {
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['123'])

    const response = await request(createApp()).get('/api/agg/campaigns?date=2026-06-02&accountId=act_123&limit=9999')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([{ campaignId: 'cmp_1', accountId: '123', spend: 42 }])
    expect(response.body.meta.limit).toBe(500)
    expect(mockCampaignFind).toHaveBeenCalledWith({
      date: '2026-06-02',
      accountId: { $in: ['123', 'act_123'] },
    })
    expect(mockCampaignLimit).toHaveBeenCalledWith(500)
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

  it('caps requested daily date ranges to the newest 90 days', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    ;(getDailySummary as jest.Mock).mockResolvedValue([])

    const response = await request(createApp())
      .get('/api/agg/daily?startDate=2026-01-01&endDate=2026-06-02')

    expect(response.status).toBe(200)
    expect(getDailySummary).toHaveBeenCalledWith('2026-03-05', '2026-06-02')
    expect(response.body.meta).toMatchObject({
      startDate: '2026-03-05',
      endDate: '2026-06-02',
      count: 0,
    })
  })

  it('caps unfiltered campaign trend rows', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)

    const response = await request(createApp())
      .get('/api/agg/campaigns/trend?limit=9999')

    expect(response.status).toBe(200)
    expect(mockCampaignFind).toHaveBeenCalledWith({
      date: { $gte: expect.any(String), $lte: expect.any(String) },
    })
    expect(mockCampaignSort).toHaveBeenCalledWith({ date: 1, spend: -1 })
    expect(mockCampaignLimit).toHaveBeenCalledWith(500)
    expect(response.body.meta.limit).toBe(500)
  })

  it('does not cap a specific campaign trend', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)

    const response = await request(createApp())
      .get('/api/agg/campaigns/trend?campaignId=cmp_1&limit=1')

    expect(response.status).toBe(200)
    expect(mockCampaignFind).toHaveBeenCalledWith({
      date: { $gte: expect.any(String), $lte: expect.any(String) },
      campaignId: 'cmp_1',
    })
    expect(mockCampaignLimit).not.toHaveBeenCalled()
    expect(response.body.meta.limit).toBeNull()
  })

  it('caps unfiltered optimizer trend rows', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)

    const response = await request(createApp())
      .get('/api/agg/optimizers/trend?limit=9999')

    expect(response.status).toBe(200)
    expect(mockOptimizerFind).toHaveBeenCalledWith({
      date: { $gte: expect.any(String), $lte: expect.any(String) },
    })
    expect(mockOptimizerSort).toHaveBeenCalledWith({ date: 1, spend: -1 })
    expect(mockOptimizerLimit).toHaveBeenCalledWith(500)
    expect(response.body.meta.limit).toBe(500)
  })
})
