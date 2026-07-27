const mockSchedule = jest.fn()
const mockWarn = jest.fn()
const mockRefreshRecentDays = jest.fn()

jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: mockSchedule,
  },
}))

jest.mock('../src/services/aggregation.service', () => ({
  refreshRecentDays: mockRefreshRecentDays,
}))

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: mockWarn,
    error: jest.fn(),
  },
}))

import initAggregationCron from '../src/cron/aggregation.cron'

describe('aggregation cron guard', () => {
  const originalSyncEnabled = process.env.FACEBOOK_SYNC_ENABLED

  afterEach(() => {
    if (originalSyncEnabled === undefined) {
      delete process.env.FACEBOOK_SYNC_ENABLED
    } else {
      process.env.FACEBOOK_SYNC_ENABLED = originalSyncEnabled
    }
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  it('does not start live Meta aggregation while Facebook sync is disabled', () => {
    process.env.FACEBOOK_SYNC_ENABLED = 'false'
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

    initAggregationCron()

    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(mockSchedule).not.toHaveBeenCalled()
    expect(mockRefreshRecentDays).not.toHaveBeenCalled()
    expect(mockWarn).toHaveBeenCalledWith(
      '[AggregationCron] Facebook sync disabled; aggregation cron not scheduled',
    )
  })
})
