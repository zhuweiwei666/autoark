const mockMetricsUpdateOne = jest.fn()
const mockRawInsightsUpdateOne = jest.fn()

jest.mock('../src/models/MetricsDaily', () => ({
  __esModule: true,
  default: {
    updateOne: mockMetricsUpdateOne,
    collection: {
      indexes: jest.fn(),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
    },
  },
}))

jest.mock('../src/models/RawInsights', () => ({
  __esModule: true,
  default: {
    updateOne: mockRawInsightsUpdateOne,
  },
}))

jest.mock('../src/models/OptimizationState', () => ({
  __esModule: true,
  default: {
    updateOne: jest.fn(),
  },
}))

import { upsertService } from '../src/services/facebook.upsert.service'

describe('facebook metrics storage limits', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMetricsUpdateOne.mockResolvedValue({})
    mockRawInsightsUpdateOne.mockResolvedValue({})
  })

  it('extracts RawInsights metrics without persisting the provider payload', async () => {
    await upsertService.upsertRawInsights({
      date: '2026-07-23',
      datePreset: 'last_7d',
      adId: 'ad-1',
      country: 'US',
      raw: { large: 'provider-payload' },
      spend: 12.34,
      impressions: 100,
      clicks: 5,
      purchase_value: 24.68,
    })

    const [, update, options] = mockRawInsightsUpdateOne.mock.calls[0]
    expect(update.$set).not.toHaveProperty('raw')
    expect(update.$unset).toEqual({ raw: '' })
    expect(update.$set).toMatchObject({
      spend: 12.34,
      impressions: 100,
      clicks: 5,
      purchase_value: 24.68,
    })
    expect(options).toEqual({ upsert: true })
  })

  it('does not duplicate the provider payload into MetricsDaily', async () => {
    await upsertService.upsertMetricsDaily({
      date: '2026-07-23',
      level: 'ad',
      entityId: 'ad-1',
      spend: 12.34,
      impressions: 100,
      clicks: 5,
      purchase_value: 24.68,
      roas: 2,
      raw: { large: 'provider-payload' },
    })

    const [, update, options] = mockMetricsUpdateOne.mock.calls[0]
    expect(update.$set).not.toHaveProperty('raw')
    expect(update.$unset).toEqual({ raw: '' })
    expect(options).toEqual({ upsert: true })
  })
})
