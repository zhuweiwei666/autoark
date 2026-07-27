const mockSchedule = jest.fn()
const mockAggregateMaterialMetrics = jest.fn()

jest.mock('node-cron', () => ({
  __esModule: true,
  default: { schedule: mockSchedule },
}))

jest.mock('../src/services/materialMetrics.service', () => ({
  aggregateMaterialMetrics: mockAggregateMaterialMetrics,
}))

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
  },
}))

import { refreshRecentMaterialMetrics } from '../src/cron/materialMetrics.cron'

describe('material metrics cron', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAggregateMaterialMetrics.mockResolvedValue({
      processed: 2,
      created: 1,
      updated: 0,
      errors: 0,
      directMatch: 2,
      fallbackMatch: 0,
    })
  })

  it('refreshes yesterday and today so late Meta insights are folded into materials', async () => {
    await refreshRecentMaterialMetrics()

    expect(mockAggregateMaterialMetrics).toHaveBeenCalledTimes(2)
    expect(mockAggregateMaterialMetrics.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(mockAggregateMaterialMetrics.mock.calls[1][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(mockAggregateMaterialMetrics.mock.calls[0][0])
      .not.toBe(mockAggregateMaterialMetrics.mock.calls[1][0])
  })
})
