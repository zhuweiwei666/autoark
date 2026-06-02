import express from 'express'
import request from 'supertest'

jest.mock('../src/services/dashboard.service', () => ({
  getDaily: jest.fn(),
  getByCountry: jest.fn(),
  getByAdSet: jest.fn(),
  getSystemHealth: jest.fn(),
  getFacebookOverview: jest.fn(),
  getCronLogs: jest.fn(),
  getOpsLogs: jest.fn(),
  getCoreMetrics: jest.fn(),
  getTodaySpendTrend: jest.fn(),
  getCampaignSpendRanking: jest.fn(),
  getCountrySpendRanking: jest.fn(),
}))

import * as dashboardController from '../src/controllers/dashboard.controller'
import * as dashboardService from '../src/services/dashboard.service'

const createApp = () => {
  const app = express()
  app.get('/daily', dashboardController.getDaily)
  app.get('/core-metrics', dashboardController.getCoreMetricsHandler)
  app.get('/campaign-ranking', dashboardController.getCampaignSpendRankingHandler)
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, error: err.message })
  })
  return app
}

describe('dashboard controller date range guardrails', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('caps legacy dashboard aggregation ranges before calling the service', async () => {
    ;(dashboardService.getDaily as jest.Mock).mockResolvedValue([{ date: '2026-06-02', spendUsd: 10 }])

    const response = await request(createApp())
      .get('/daily?startDate=2020-01-01&endDate=2026-06-02&channel=facebook&country=US')

    expect(response.status).toBe(200)
    expect(dashboardService.getDaily).toHaveBeenCalledWith({
      startDate: '2026-03-05',
      endDate: '2026-06-02',
      channel: 'facebook',
      country: 'US',
    })
  })

  it('caps Meta Insights dashboard ranges before calling ranking services', async () => {
    ;(dashboardService.getCampaignSpendRanking as jest.Mock).mockResolvedValue([])

    const response = await request(createApp())
      .get('/campaign-ranking?startDate=2020-01-01&endDate=2026-06-02&limit=9999')

    expect(response.status).toBe(200)
    expect(dashboardService.getCampaignSpendRanking).toHaveBeenCalledWith(
      100,
      '2026-03-05',
      '2026-06-02',
    )
  })

  it('rejects invalid dashboard dates before calling services', async () => {
    const response = await request(createApp()).get('/core-metrics?startDate=2026-02-30')

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: 'startDate must be a valid YYYY-MM-DD date',
      meta: { maxDays: 90 },
    })
    expect(dashboardService.getCoreMetrics).not.toHaveBeenCalled()
  })

  it('rejects reversed dashboard date ranges before calling services', async () => {
    const response = await request(createApp())
      .get('/core-metrics?startDate=2026-06-03&endDate=2026-06-02')

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: 'startDate must be earlier than or equal to endDate',
      meta: { maxDays: 90 },
    })
    expect(dashboardService.getCoreMetrics).not.toHaveBeenCalled()
  })
})
