const mockIndexes = jest.fn()
const mockDropIndex = jest.fn()
const mockCreateIndex = jest.fn()

jest.mock('../src/models/MetricsDaily', () => ({
  __esModule: true,
  default: {
    collection: {
      indexes: mockIndexes,
      dropIndex: mockDropIndex,
      createIndex: mockCreateIndex,
    },
  },
}))

jest.mock('../src/models/RawInsights', () => ({
  __esModule: true,
  default: {},
}))

jest.mock('../src/models/OptimizationState', () => ({
  __esModule: true,
  default: {},
}))

import { ensureMetricsDailyIndexCompatibility } from '../src/services/facebook.upsert.service'

describe('MetricsDaily legacy index compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDropIndex.mockResolvedValue(undefined)
    mockCreateIndex.mockResolvedValue('adId_1_date_1')
  })

  it('replaces the legacy ad/date unique index with a non-unique lookup index', async () => {
    mockIndexes.mockResolvedValue([
      { name: '_id_', key: { _id: 1 }, unique: true },
      { name: 'adId_1_date_1', key: { adId: 1, date: 1 }, unique: true },
      { name: 'date_1_level_1_entityId_1_country_1', key: { date: 1, level: 1, entityId: 1, country: 1 }, unique: true },
    ])

    const result = await ensureMetricsDailyIndexCompatibility()

    expect(mockDropIndex).toHaveBeenCalledWith('adId_1_date_1')
    expect(mockCreateIndex).toHaveBeenCalledWith(
      { adId: 1, date: 1 },
      { name: 'adId_1_date_1', unique: false, background: true },
    )
    expect(result).toEqual({ replacedLegacyUniqueIndex: true })
  })

  it('leaves an already non-unique ad/date index untouched', async () => {
    mockIndexes.mockResolvedValue([
      { name: 'adId_1_date_1', key: { adId: 1, date: 1 } },
    ])

    const result = await ensureMetricsDailyIndexCompatibility()

    expect(mockDropIndex).not.toHaveBeenCalled()
    expect(mockCreateIndex).not.toHaveBeenCalled()
    expect(result).toEqual({ replacedLegacyUniqueIndex: false })
  })
})
