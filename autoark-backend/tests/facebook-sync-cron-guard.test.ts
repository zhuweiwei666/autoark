const mockSchedule = jest.fn()
const mockWarn = jest.fn()

jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: mockSchedule,
  },
}))

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: mockWarn,
    cron: jest.fn(),
    cronError: jest.fn(),
  },
}))

import initSyncCronV2 from '../src/cron/sync.cron.v2'

describe('facebook sync cron guard', () => {
  const originalSyncEnabled = process.env.FACEBOOK_SYNC_ENABLED

  afterEach(() => {
    if (originalSyncEnabled === undefined) {
      delete process.env.FACEBOOK_SYNC_ENABLED
    } else {
      process.env.FACEBOOK_SYNC_ENABLED = originalSyncEnabled
    }
    jest.clearAllMocks()
  })

  it('does not register the producer cron while sync is disabled', () => {
    process.env.FACEBOOK_SYNC_ENABLED = 'false'

    initSyncCronV2()

    expect(mockSchedule).not.toHaveBeenCalled()
    expect(mockWarn).toHaveBeenCalledWith(
      '[Sync Cron V2] Facebook sync disabled; cron not scheduled',
    )
  })
})
