const mockAccountFind = jest.fn()
const mockFetchInsights = jest.fn()

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: mockAccountFind,
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
}))

jest.mock('../src/models/MetricsDaily', () => ({
  __esModule: true,
  default: {},
}))

jest.mock('../src/services/facebook.api', () => ({
  fetchUserAdAccounts: jest.fn(),
  fetchInsights: mockFetchInsights,
}))

import { getAccounts } from '../src/services/facebook.accounts.service'

const leanQuery = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

describe('facebook account insights date ranges', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAccountFind.mockReturnValue(leanQuery([
      {
        accountId: '123',
        name: 'Account 123',
        token: 'token-account-123',
        amountSpent: '1000',
        balance: '5000',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]))
    mockFetchInsights.mockResolvedValue([{ spend: '42' }])
  })

  it('caps endDate-only account spend ranges before calling Facebook Insights', async () => {
    const result = await getAccounts(
      { endDate: '2026-06-02' },
      { page: 1, limit: 20, sortBy: 'periodSpend', sortOrder: 'desc' },
    )

    expect(mockFetchInsights).toHaveBeenCalledWith(
      'act_123',
      'account',
      undefined,
      'token-account-123',
      undefined,
      { since: '2026-03-05', until: '2026-06-02' },
    )
    expect(result.data[0].periodSpend).toBe(42)
    expect(result.data[0]).not.toHaveProperty('token')
  })

  it('caps overly large account spend ranges before calling Facebook Insights', async () => {
    await getAccounts(
      { startDate: '2020-01-01', endDate: '2026-06-02' },
      { page: 1, limit: 20, sortBy: 'periodSpend', sortOrder: 'desc' },
    )

    expect(mockFetchInsights).toHaveBeenCalledWith(
      'act_123',
      'account',
      undefined,
      'token-account-123',
      undefined,
      { since: '2026-03-05', until: '2026-06-02' },
    )
  })

  it('rejects invalid account spend dates before calling Facebook Insights', async () => {
    await expect(getAccounts(
      { startDate: '2026-02-31', endDate: '2026-06-02' },
      { page: 1, limit: 20, sortBy: 'periodSpend', sortOrder: 'desc' },
    )).rejects.toMatchObject({
      statusCode: 400,
      message: 'startDate must be a valid YYYY-MM-DD date',
    })

    expect(mockFetchInsights).not.toHaveBeenCalled()
  })

  it('rejects reversed account spend date ranges before calling Facebook Insights', async () => {
    await expect(getAccounts(
      { startDate: '2026-06-03', endDate: '2026-06-02' },
      { page: 1, limit: 20, sortBy: 'periodSpend', sortOrder: 'desc' },
    )).rejects.toMatchObject({
      statusCode: 400,
      message: 'startDate must be earlier than or equal to endDate',
    })

    expect(mockFetchInsights).not.toHaveBeenCalled()
  })
})
