jest.mock('../src/config/redis', () => ({
  getRedisClient: jest.fn(() => null),
  getRedisConnection: jest.fn(),
}))

import { pauseFacebookSyncQueues } from '../src/queue/facebook.queue'

describe('facebook queue production stop', () => {
  it('globally pauses every available pipeline queue before workers start', async () => {
    const activeQueue = {
      isPaused: jest.fn().mockResolvedValue(false),
      pause: jest.fn().mockResolvedValue(undefined),
    }
    const alreadyPausedQueue = {
      isPaused: jest.fn().mockResolvedValue(true),
      pause: jest.fn().mockResolvedValue(undefined),
    }

    const result = await pauseFacebookSyncQueues([
      { name: 'facebook.account.sync', queue: activeQueue },
      { name: 'facebook.campaign.sync', queue: alreadyPausedQueue },
    ])

    expect(activeQueue.pause).toHaveBeenCalledTimes(1)
    expect(alreadyPausedQueue.pause).not.toHaveBeenCalled()
    expect(result).toEqual({
      available: true,
      pausedQueues: ['facebook.account.sync', 'facebook.campaign.sync'],
    })
  })
})
