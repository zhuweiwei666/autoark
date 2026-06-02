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
