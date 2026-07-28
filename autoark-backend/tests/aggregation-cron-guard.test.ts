const mockSchedule = jest.fn()
const mockWarn = jest.fn()
const mockRefreshAggregation = jest.fn()

jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: mockSchedule,
  },
}))

jest.mock('../src/services/aggregation.service', () => ({
  refreshAggregation: mockRefreshAggregation,
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
  const originalAggregationEnabled = process.env.FACEBOOK_AGGREGATION_ENABLED

  afterEach(() => {
    if (originalSyncEnabled === undefined) {
      delete process.env.FACEBOOK_SYNC_ENABLED
    } else {
      process.env.FACEBOOK_SYNC_ENABLED = originalSyncEnabled
    }
    if (originalAggregationEnabled === undefined) {
      delete process.env.FACEBOOK_AGGREGATION_ENABLED
    } else {
      process.env.FACEBOOK_AGGREGATION_ENABLED = originalAggregationEnabled
    }
    jest.clearAllMocks()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('does not start live Meta aggregation while its dedicated flag is disabled', () => {
    process.env.FACEBOOK_SYNC_ENABLED = 'true'
    process.env.FACEBOOK_AGGREGATION_ENABLED = 'false'
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

    initAggregationCron()

    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(mockSchedule).not.toHaveBeenCalled()
    expect(mockRefreshAggregation).not.toHaveBeenCalled()
    expect(mockWarn).toHaveBeenCalledWith(
      '[AggregationCron] Meta aggregation disabled; cron not scheduled',
    )
  })

  it('starts today-only aggregation without resuming Facebook sync queues', async () => {
    process.env.FACEBOOK_SYNC_ENABLED = 'false'
    process.env.FACEBOOK_AGGREGATION_ENABLED = 'true'
    jest.useFakeTimers().setSystemTime(new Date('2026-07-28T09:00:00.000Z'))
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

    initAggregationCron()

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
    expect(mockSchedule).toHaveBeenCalledTimes(1)

    const initialRefresh = setTimeoutSpy.mock.calls[0][0] as () => Promise<void>
    await initialRefresh()

    expect(mockRefreshAggregation).toHaveBeenCalledTimes(1)
    expect(mockRefreshAggregation).toHaveBeenCalledWith('2026-07-28')
  })

  it('skips overlapping scheduled refreshes while the first run is active', async () => {
    process.env.FACEBOOK_SYNC_ENABLED = 'false'
    process.env.FACEBOOK_AGGREGATION_ENABLED = 'true'
    jest.useFakeTimers().setSystemTime(new Date('2026-07-28T09:00:00.000Z'))

    let releaseRefresh: (() => void) | undefined
    mockRefreshAggregation.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseRefresh = resolve
        }),
    )

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
    let scheduledRefresh: (() => Promise<void>) | undefined
    mockSchedule.mockImplementationOnce(
      (_schedule: string, handler: () => Promise<void>) => {
        scheduledRefresh = handler
      },
    )

    initAggregationCron()

    const initialRefresh = setTimeoutSpy.mock.calls[0][0] as () => Promise<void>
    const initialRun = initialRefresh()
    await Promise.resolve()

    expect(scheduledRefresh).toBeDefined()
    await scheduledRefresh!()

    expect(mockRefreshAggregation).toHaveBeenCalledTimes(1)
    expect(mockWarn).toHaveBeenCalledWith(
      '[AggregationCron] Refresh already in progress; skipping scheduled refresh',
    )

    releaseRefresh!()
    await initialRun
  })
})
