const mockFetchUserAdAccounts = jest.fn()

jest.mock('../src/services/facebook.api', () => ({
  fetchUserAdAccounts: mockFetchUserAdAccounts,
  fetchInsights: jest.fn(),
}))

jest.mock('../src/models/FbToken', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
}))

jest.mock('../src/models/FacebookUser', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}))

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    bulkWrite: jest.fn(),
  },
}))

import Account from '../src/models/Account'
import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import { syncAccountsFromTokens } from '../src/services/facebook.accounts.service'

const queryResult = (value: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
})

describe('facebook account cache import', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T08:00:00.000Z'))
    ;(FbToken.find as jest.Mock).mockResolvedValue([{
      _id: 'token_a',
      token: 'TOKEN_A',
      optimizer: 'opt-a',
      organizationId: { toString: () => '665000000000000000000001' },
    }])
    ;(FacebookUser.findOne as jest.Mock).mockReturnValue(queryResult({
      adAccounts: [{
        accountId: '123',
        name: 'Cached Account 123',
        status: 1,
        currency: 'USD',
        timezone: 'America/Los_Angeles',
      }],
    }))
    ;(Account.find as jest.Mock).mockReturnValue(queryResult([]))
    ;(Account.bulkWrite as jest.Mock).mockResolvedValue({ modifiedCount: 0, upsertedCount: 1 })
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({})
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('imports cached accounts in bulk without reading Meta again', async () => {
    const result = await syncAccountsFromTokens()

    expect(mockFetchUserAdAccounts).not.toHaveBeenCalled()
    expect(Account.bulkWrite).toHaveBeenCalledTimes(1)
    expect(Account.bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: expect.objectContaining({ channel: 'facebook', accountId: '123' }),
            upsert: true,
          }),
        }),
      ],
      { ordered: false },
    )
    expect(result).toMatchObject({
      syncedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      cacheTokenCount: 1,
      liveTokenCount: 0,
    })
  })

  it('preserves optional catalog fields when the cache omits them', async () => {
    ;(FbToken.find as jest.Mock).mockResolvedValue([{
      _id: 'token_a',
      token: 'TOKEN_A',
      organizationId: { toString: () => '665000000000000000000001' },
    }])
    ;(FacebookUser.findOne as jest.Mock).mockReturnValue(queryResult({
      adAccounts: [{ accountId: '123', name: 'Cached Account 123' }],
    }))

    await syncAccountsFromTokens()

    const update = (Account.bulkWrite as jest.Mock).mock.calls[0][0][0].updateOne.update.$set
    expect(update).not.toHaveProperty('status')
    expect(update).not.toHaveProperty('accountStatus')
    expect(update).not.toHaveProperty('operator')
  })

  it('opens a bounded insights finalization window when an active account becomes disabled', async () => {
    ;(FacebookUser.findOne as jest.Mock).mockReturnValue(queryResult({
      adAccounts: [{
        accountId: '123',
        name: 'Cached Account 123',
        status: 2,
      }],
    }))
    const existingAccountQuery = queryResult([{
      accountId: '123',
      organizationId: { toString: () => '665000000000000000000001' },
      status: 'active',
    }])
    ;(Account.find as jest.Mock).mockReturnValue(existingAccountQuery)

    await syncAccountsFromTokens()

    expect(existingAccountQuery.select).toHaveBeenCalledWith('accountId organizationId status')
    const update = (Account.bulkWrite as jest.Mock).mock.calls[0][0][0].updateOne.update
    expect(update.$set).toMatchObject({
      status: 'disabled',
      statusChangedAt: new Date('2026-07-27T08:00:00.000Z'),
      insightsFinalizationUntil: new Date('2026-07-30T08:00:00.000Z'),
    })
  })

  it('does not renew the finalization window for an account that remains disabled', async () => {
    ;(FacebookUser.findOne as jest.Mock).mockReturnValue(queryResult({
      adAccounts: [{ accountId: '123', status: 2 }],
    }))
    ;(Account.find as jest.Mock).mockReturnValue(queryResult([{
      accountId: '123',
      organizationId: { toString: () => '665000000000000000000001' },
      status: 'disabled',
    }]))

    await syncAccountsFromTokens()

    const update = (Account.bulkWrite as jest.Mock).mock.calls[0][0][0].updateOne.update
    expect(update.$set).not.toHaveProperty('statusChangedAt')
    expect(update.$set).not.toHaveProperty('insightsFinalizationUntil')
  })

  it('does not open a finalization window for an account first discovered as disabled', async () => {
    ;(FacebookUser.findOne as jest.Mock).mockReturnValue(queryResult({
      adAccounts: [{ accountId: '123', status: 2 }],
    }))

    await syncAccountsFromTokens()

    const update = (Account.bulkWrite as jest.Mock).mock.calls[0][0][0].updateOne.update
    expect(update.$set).not.toHaveProperty('statusChangedAt')
    expect(update.$set).not.toHaveProperty('insightsFinalizationUntil')
  })

  it('clears the finalization window when a disabled account becomes active again', async () => {
    ;(Account.find as jest.Mock).mockReturnValue(queryResult([{
      accountId: '123',
      organizationId: { toString: () => '665000000000000000000001' },
      status: 'disabled',
    }]))

    await syncAccountsFromTokens()

    const update = (Account.bulkWrite as jest.Mock).mock.calls[0][0][0].updateOne.update
    expect(update.$set).toMatchObject({
      status: 'active',
      lastActiveAt: new Date('2026-07-27T08:00:00.000Z'),
      statusChangedAt: new Date('2026-07-27T08:00:00.000Z'),
    })
    expect(update.$unset).toEqual({ insightsFinalizationUntil: 1 })
  })
})
