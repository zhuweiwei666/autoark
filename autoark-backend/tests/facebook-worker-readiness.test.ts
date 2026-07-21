const mockWaitUntilReady = jest.fn().mockResolvedValue(undefined)
const mockOn = jest.fn()
const mockDuplicate = jest.fn(() => ({
  options: { maxRetriesPerRequest: 20 },
}))

const createdWorkers: any[] = []

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((name, processor, options) => {
    const worker = {
      name,
      processor,
      options,
      on: mockOn,
      waitUntilReady: mockWaitUntilReady,
    }
    createdWorkers.push(worker)
    return worker
  }),
}))

jest.mock('../src/config/redis', () => ({
  getRedisClient: jest.fn(() => ({ duplicate: mockDuplicate })),
}))

jest.mock('../src/queue/facebook.queue', () => ({
  accountQueue: { add: jest.fn() },
  campaignQueue: { add: jest.fn() },
  adQueue: { add: jest.fn() },
  materialQueue: { add: jest.fn() },
}))

jest.mock('../src/integration/facebook/campaigns.api', () => ({
  fetchCampaigns: jest.fn(),
}))

jest.mock('../src/integration/facebook/insights.api', () => ({
  fetchInsights: jest.fn(),
}))

jest.mock('../src/services/facebook.upsert.service', () => ({
  upsertService: {},
}))

jest.mock('../src/services/facebookMaterialIngestion.service', () => ({
  ingestCreativeAssets: jest.fn(),
}))

jest.mock('../src/models/Campaign', () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn() },
}))

jest.mock('../src/models/Ad', () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn() },
}))

jest.mock('../src/models/AdSet', () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn() },
}))

jest.mock('../src/models/Creative', () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn() },
}))

import { initWorkers } from '../src/queue/facebook.worker'

describe('facebook worker startup readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createdWorkers.length = 0
  })

  it('does not finish initialization until every worker is ready', async () => {
    const result = initWorkers()

    expect(result).toBeInstanceOf(Promise)
    await result

    expect(createdWorkers.map((worker) => worker.name)).toEqual([
      'facebook.account.sync',
      'facebook.campaign.sync',
      'facebook.ad.sync',
      'facebook.material.sync',
    ])
    expect(mockWaitUntilReady).toHaveBeenCalledTimes(4)
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function))
  })
})
