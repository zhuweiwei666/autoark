const mockFacebookPost = jest.fn()
const mockAccountFindOne = jest.fn()
const mockResolvePublishingCredential = jest.fn()
const mockOptimizationStateUpdate = jest.fn()

jest.mock('../src/integration/facebook/facebookClient', () => ({
  facebookClient: {
    post: mockFacebookPost,
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    findOne: mockAccountFindOne,
  },
}))

jest.mock('../src/models/OptimizationState', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: mockOptimizationStateUpdate,
  },
}))

jest.mock('../src/services/metaBusinessCredential.service', () => ({
  resolvePublishingCredential: mockResolvePublishingCredential,
}))

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
  },
}))

import { executionService } from '../src/domain/optimizer/execution.service'

describe('optimizer System User write authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAccountFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          organizationId: '665000000000000000000001',
          token: 'PERSONAL_ACCOUNT_TOKEN',
        }),
      }),
    })
    mockResolvePublishingCredential.mockResolvedValue({
      token: 'SYSTEM_USER_TOKEN',
      credential: { _id: '665000000000000000000099' },
    })
    mockFacebookPost.mockResolvedValue({ success: true })
    mockOptimizationStateUpdate.mockResolvedValue({})
  })

  it('uses the organization System User token for budget writes even when a personal token is supplied', async () => {
    const executed = await executionService.execute(
      'campaign_123',
      'campaign',
      {
        type: 'ADJUST_BUDGET',
        newBudget: 42,
        reason: 'test',
      } as any,
      'act_123',
      'CALLER_PERSONAL_TOKEN',
    )

    expect(executed).toBe(true)
    expect(mockResolvePublishingCredential).toHaveBeenCalledWith({
      organizationId: '665000000000000000000001',
      adAccountIds: ['123'],
    })
    expect(mockFacebookPost).toHaveBeenCalledWith('/campaign_123', {
      daily_budget: 4200,
      access_token: 'SYSTEM_USER_TOKEN',
    })
    expect(JSON.stringify(mockFacebookPost.mock.calls)).not.toContain('CALLER_PERSONAL_TOKEN')
  })

  it('uses the same System User token for pause operations', async () => {
    await executionService.execute(
      'campaign_123',
      'campaign',
      { type: 'PAUSE_ENTITY', reason: 'test' } as any,
      '123',
    )

    expect(mockFacebookPost).toHaveBeenCalledWith('/campaign_123', {
      status: 'PAUSED',
      access_token: 'SYSTEM_USER_TOKEN',
    })
  })
})
