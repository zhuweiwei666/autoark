const mockMetricsDailyAggregate = jest.fn()

jest.mock('../src/models', () => ({
  MetricsDaily: {
    aggregate: mockMetricsDailyAggregate,
  },
  Account: {
    countDocuments: jest.fn(),
    find: jest.fn(),
  },
  Campaign: {
    countDocuments: jest.fn(),
    find: jest.fn(),
  },
  Ad: {
    countDocuments: jest.fn(),
  },
  SyncLog: {
    findOne: jest.fn(),
    find: jest.fn(),
  },
  OpsLog: {
    find: jest.fn(),
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}))

jest.mock('../src/services/facebook.api', () => ({
  fetchInsights: jest.fn(),
}))

import { getDaily } from '../src/services/dashboard.service'

describe('dashboard service filter safety', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('sanitizes direct dashboard aggregation filters before querying', async () => {
    mockMetricsDailyAggregate.mockResolvedValue([])

    await getDaily({
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      channel: { $ne: 'facebook' },
      country: { $ne: 'US' },
    } as any)

    expect(mockMetricsDailyAggregate).toHaveBeenCalledWith(expect.arrayContaining([
      {
        $match: {
          date: { $gte: '2026-06-01', $lte: '2026-06-02' },
        },
      },
    ]))
  })

  it('keeps valid dashboard channel and country filters', async () => {
    mockMetricsDailyAggregate.mockResolvedValue([])

    await getDaily({
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      channel: 'facebook',
      country: 'US',
    })

    expect(mockMetricsDailyAggregate).toHaveBeenCalledWith(expect.arrayContaining([
      {
        $match: {
          date: { $gte: '2026-06-01', $lte: '2026-06-02' },
          channel: 'facebook',
          country: 'US',
        },
      },
    ]))
  })
})
