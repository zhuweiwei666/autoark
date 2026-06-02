jest.mock('../src/middlewares/auth', () => {
  const actual = jest.requireActual('../src/middlewares/auth')
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        userId: '665000000000000000000002',
        role: 'super_admin',
      }
      next()
    },
  }
})

jest.mock('../src/services/materialMetrics.service', () => ({
  aggregateMaterialMetrics: jest.fn(),
  getMaterialRankings: jest.fn(),
  getMaterialTrend: jest.fn(),
  findDuplicateMaterials: jest.fn(),
  getMaterialUsage: jest.fn(),
  getRecommendedMaterials: jest.fn(),
  getDecliningMaterials: jest.fn(),
}))

const express = require('express')
const request = require('supertest')
const materialMetricsRoutes = require('../src/routes/materialMetrics.routes').default
const materialMetricsService = require('../src/services/materialMetrics.service')

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/material-metrics', materialMetricsRoutes)
  return app
}

describe('material metrics backfill guardrails', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('rejects invalid ranking dates before querying material rankings', async () => {
    const response = await request(createApp())
      .get('/api/material-metrics/rankings')
      .query({ startDate: '2026-02-31', endDate: '2026-03-01' })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: 'startDate must be a valid YYYY-MM-DD date',
    })
    expect(materialMetricsService.getMaterialRankings).not.toHaveBeenCalled()
  })

  it('rejects ranking windows longer than the bounded range', async () => {
    const response = await request(createApp())
      .get('/api/material-metrics/rankings')
      .query({ startDate: '2026-01-01', endDate: '2026-04-15' })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      meta: {
        requestedDays: 105,
        maxDays: 90,
      },
    })
    expect(materialMetricsService.getMaterialRankings).not.toHaveBeenCalled()
  })

  it('normalizes ranking date defaults and caps ranking limit', async () => {
    materialMetricsService.getMaterialRankings.mockResolvedValue([])

    const response = await request(createApp())
      .get('/api/material-metrics/rankings')
      .query({ endDate: '2026-06-02', limit: '9999' })

    expect(response.status).toBe(200)
    expect(materialMetricsService.getMaterialRankings).toHaveBeenCalledWith(expect.objectContaining({
      dateRange: { start: '2026-05-26', end: '2026-06-02' },
      limit: 100,
    }))
    expect(response.body.query).toMatchObject({
      startDate: '2026-05-26',
      endDate: '2026-06-02',
      limit: 100,
    })
  })

  it('sanitizes ranking sort and material type filters', async () => {
    materialMetricsService.getMaterialRankings.mockResolvedValue([])

    const response = await request(createApp())
      .get('/api/material-metrics/rankings')
      .query({ endDate: '2026-06-02', sortBy: 'unknownField', type: 'document' })

    expect(response.status).toBe(200)
    expect(materialMetricsService.getMaterialRankings).toHaveBeenCalledWith(expect.objectContaining({
      sortBy: 'roas',
      materialType: undefined,
    }))
    expect(response.body.query).toMatchObject({
      sortBy: 'roas',
    })
    expect(response.body.query).not.toHaveProperty('type')
  })

  it('rejects invalid aggregate dates before running material aggregation', async () => {
    const response = await request(createApp())
      .post('/api/material-metrics/aggregate')
      .send({ date: '2026-02-31' })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: 'date must be a valid YYYY-MM-DD date',
    })
    expect(materialMetricsService.aggregateMaterialMetrics).not.toHaveBeenCalled()
  })

  it('rejects backfill windows longer than the bounded range', async () => {
    const response = await request(createApp())
      .post('/api/material-metrics/backfill')
      .send({ startDate: '2026-01-01', endDate: '2026-02-15' })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      meta: {
        requestedDays: 46,
        maxDays: 31,
      },
    })
    expect(materialMetricsService.aggregateMaterialMetrics).not.toHaveBeenCalled()
  })

  it('runs bounded backfills across an inclusive date range', async () => {
    materialMetricsService.aggregateMaterialMetrics.mockResolvedValue({
      processed: 1,
      created: 1,
      updated: 0,
      errors: 0,
      directMatch: 1,
      fallbackMatch: 0,
    })

    const response = await request(createApp())
      .post('/api/material-metrics/backfill')
      .send({ startDate: '2026-01-01', endDate: '2026-01-03' })

    expect(response.status).toBe(200)
    expect(materialMetricsService.aggregateMaterialMetrics).toHaveBeenCalledTimes(3)
    expect(materialMetricsService.aggregateMaterialMetrics).toHaveBeenNthCalledWith(1, '2026-01-01')
    expect(materialMetricsService.aggregateMaterialMetrics).toHaveBeenNthCalledWith(3, '2026-01-03')
    expect(response.body.summary).toMatchObject({
      daysProcessed: 3,
      successCount: 3,
      errorCount: 0,
    })
  })
})
