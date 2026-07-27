const mockAccountFind = jest.fn()
const mockCampaignLean = jest.fn()
const mockCampaignSelect = jest.fn(() => ({ lean: mockCampaignLean }))
const mockCampaignFind = jest.fn(() => ({ select: mockCampaignSelect }))
const mockTokenLean = jest.fn()
const mockTokenFind = jest.fn(() => ({ lean: mockTokenLean }))
const mockDailyUpsert = jest.fn()
const mockPreviouslyAggregatedAccountIds = jest.fn()

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockAccountFind(...args),
  },
}))

jest.mock('../src/models/Campaign', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockCampaignFind(...args),
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockTokenFind(...args),
  },
}))

jest.mock('../src/models/Aggregation', () => ({
  AggDaily: {
    findOneAndUpdate: (...args: any[]) => mockDailyUpsert(...args),
  },
  AggCountry: { bulkWrite: jest.fn() },
  AggAccount: {
    distinct: (...args: any[]) => mockPreviouslyAggregatedAccountIds(...args),
    bulkWrite: jest.fn(),
  },
  AggCampaign: { bulkWrite: jest.fn() },
  AggOptimizer: { bulkWrite: jest.fn() },
  isRecentDate: jest.fn(() => true),
}))

jest.mock('../src/integration/facebook/insights.api', () => ({
  fetchInsights: jest.fn(),
}))

import { refreshAggregation } from '../src/services/aggregation.service'

describe('aggregation account eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T08:00:00.000Z'))
    mockTokenLean.mockResolvedValue([{ token: 'TOKEN_A' }])
    mockAccountFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    mockCampaignLean.mockResolvedValue([])
    mockDailyUpsert.mockResolvedValue({})
    mockPreviouslyAggregatedAccountIds.mockResolvedValue(['123'])
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('refreshes active, finalizing, and already aggregated accounts for the exact date', async () => {
    await refreshAggregation('2026-07-27')

    expect(mockPreviouslyAggregatedAccountIds).toHaveBeenCalledWith(
      'accountId',
      {
        date: '2026-07-27',
      },
    )
    expect(mockAccountFind).toHaveBeenCalledWith({
      channel: 'facebook',
      $or: [
        { status: 'active' },
        {
          insightsFinalizationUntil: {
            $gte: new Date('2026-07-27T08:00:00.000Z'),
          },
        },
        {
          accountId: {
            $in: ['123'],
          },
        },
      ],
    })
  })
})
