import express from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

const mockAuthState: { user: any } = { user: null }

jest.mock('../src/middlewares/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = mockAuthState.user
    next()
  },
  getUserAccountIds: jest.fn(),
}))

jest.mock('../src/services/aggregation.service', () => ({
  refreshRecentDays: jest.fn(),
}))

jest.mock('../src/models/MaterialMetrics', () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn(),
  },
}))

jest.mock('../src/models/Aggregation', () => ({
  AggDaily: {
    find: jest.fn(),
    findOne: jest.fn(),
  },
  AggCountry: {
    aggregate: jest.fn(),
  },
  AggAccount: {
    find: jest.fn(),
    aggregate: jest.fn(),
  },
  AggCampaign: {
    aggregate: jest.fn(),
  },
  AggOptimizer: {},
}))

import summaryRouter from '../src/controllers/summary.controller'
import { getUserAccountIds } from '../src/middlewares/auth'
import { AggAccount, AggCampaign, AggCountry, AggDaily } from '../src/models/Aggregation'

const createApp = () => {
  const app = express()
  app.use('/api/summary', summaryRouter)
  return app
}

describe('summary route data scoping', () => {
  afterEach(() => {
    jest.clearAllMocks()
    mockAuthState.user = null
  })

  it('does not expose global country summary to organization users', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }

    const response = await request(createApp()).get('/api/summary/countries')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      success: true,
      data: [],
      pagination: { page: 1, limit: 50, total: 0, pages: 0 },
      cached: true,
    })
    expect(AggCountry.aggregate).not.toHaveBeenCalled()
  })

  it('keeps global country summary available to super admins', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(AggCountry.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ country: 'US', spend: 10 }],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(createApp()).get('/api/summary/countries?limit=10')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([{ country: 'US', spend: 10 }])
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 10, total: 1, pages: 1 })
    expect(AggCountry.aggregate).toHaveBeenCalledTimes(1)
  })

  it('returns scoped account summary to organization users', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['act_123'])
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ accountId: 'act_123', accountName: 'Scoped account', spend: 42 }],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(createApp()).get('/api/summary/accounts?limit=10')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([{ accountId: 'act_123', accountName: 'Scoped account', spend: 42 }])
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 10, total: 1, pages: 1 })
    expect(AggAccount.aggregate).toHaveBeenCalledTimes(1)
    expect((AggAccount.aggregate as jest.Mock).mock.calls[0][0][0]).toMatchObject({
      $match: {
        accountId: { $in: ['123', 'act_123'] },
      },
    })
  })

  it('caps large summary limits and falls back to safe sort fields', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ accountId: 'act_999', accountName: 'Large account', spend: 99 }],
        total: [{ count: 250 }],
      },
    ])

    const response = await request(createApp())
      .get('/api/summary/accounts?limit=10000&page=3&sortBy=unsafeField')

    expect(response.status).toBe(200)
    expect(response.body.pagination).toMatchObject({ page: 3, limit: 100, total: 250, pages: 3 })

    const pipeline = (AggAccount.aggregate as jest.Mock).mock.calls[0][0]
    expect(pipeline.find((stage: any) => stage.$sort)).toEqual({ $sort: { spend: -1 } })
    expect(pipeline.find((stage: any) => stage.$facet).$facet.data).toEqual([
      { $skip: 200 },
      { $limit: 100 },
    ])
  })

  it('caps dashboard trend day windows before building the response', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }
    ;(AggDaily.find as jest.Mock).mockReturnValue(findQuery)

    const response = await request(createApp()).get('/api/summary/dashboard/trend?days=100000')

    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(90)
    expect(AggDaily.find).toHaveBeenCalledTimes(1)
    expect(findQuery.sort).toHaveBeenCalledWith({ date: 1 })
  })

  it('caps summary aggregation date ranges before querying account rows', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(null)
    ;(AggAccount.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ accountId: 'act_999', accountName: 'Large account', spend: 99 }],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(createApp())
      .get('/api/summary/accounts?startDate=2020-01-01&endDate=2026-06-02&limit=10')

    expect(response.status).toBe(200)
    const pipeline = (AggAccount.aggregate as jest.Mock).mock.calls[0][0]
    expect(pipeline[0]).toMatchObject({
      $match: {
        date: { $gte: '2026-03-05', $lte: '2026-06-02' },
      },
    })
  })

  it('rejects invalid summary date filters before querying aggregates', async () => {
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000003',
    }

    const response = await request(createApp()).get('/api/summary/dashboard?startDate=2026-02-30')

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: 'startDate must be a valid YYYY-MM-DD date',
      meta: { maxDays: 90 },
    })
    expect(AggDaily.find).not.toHaveBeenCalled()
  })

  it('returns empty account summary when organization user has no linked accounts', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue([])

    const response = await request(createApp()).get('/api/summary/accounts')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      success: true,
      data: [],
      pagination: { page: 1, limit: 100, total: 0, pages: 0 },
      cached: true,
    })
    expect(AggAccount.aggregate).not.toHaveBeenCalled()
  })

  it('matches campaign account filters across act_ account id formats', async () => {
    mockAuthState.user = {
      role: UserRole.ORG_ADMIN,
      organizationId: '665000000000000000000001',
      userId: '665000000000000000000002',
    }
    ;(getUserAccountIds as jest.Mock).mockResolvedValue(['123'])
    ;(AggCampaign.aggregate as jest.Mock).mockResolvedValue([
      {
        data: [{ campaignId: 'cmp_1', accountId: '123', spend: 42 }],
        total: [{ count: 1 }],
      },
    ])

    const response = await request(createApp()).get('/api/summary/campaigns?accountId=act_123&limit=10')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([{ campaignId: 'cmp_1', accountId: '123', spend: 42 }])
    expect(AggCampaign.aggregate).toHaveBeenCalledTimes(1)
    expect((AggCampaign.aggregate as jest.Mock).mock.calls[0][0][0]).toMatchObject({
      $match: {
        accountId: { $in: ['123', 'act_123'] },
      },
    })
  })
})
