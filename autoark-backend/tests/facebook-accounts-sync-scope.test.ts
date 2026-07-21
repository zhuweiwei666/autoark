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
    bulkWrite: jest.fn(),
  },
}))

import Account from '../src/models/Account'
import FbToken from '../src/models/FbToken'
import FacebookUser from '../src/models/FacebookUser'
import { syncAccountsFromTokens } from '../src/services/facebook.accounts.service'

const queryResult = (result: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(result),
  }),
})

describe('facebook account sync tenant scope', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('upserts facebook accounts by channel and normalized account id', async () => {
    ;(FbToken.find as jest.Mock).mockResolvedValue([{
      _id: 'token_a',
      token: 'TOKEN_A',
      optimizer: 'opt-a',
      organizationId: { toString: () => '665000000000000000000001' },
    }])
    ;(FacebookUser.findOne as jest.Mock).mockReturnValue(queryResult(null))
    mockFetchUserAdAccounts.mockResolvedValue([{
      id: 'act_123',
      name: 'Account 123',
      account_status: 1,
    }])
    ;(Account.find as jest.Mock).mockReturnValue(queryResult([]))
    ;(Account.bulkWrite as jest.Mock).mockResolvedValue({} as any)
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({} as any)

    const result = await syncAccountsFromTokens()

    expect(Account.find).toHaveBeenCalledWith({
      channel: 'facebook',
      accountId: { $in: ['123'] },
    })
    expect(Account.bulkWrite).toHaveBeenCalledWith(
      [{
        updateOne: {
          filter: expect.objectContaining({
            channel: 'facebook',
            accountId: '123',
            $or: expect.arrayContaining([
              { organizationId: expect.anything() },
              { organizationId: { $exists: false } },
              { organizationId: null },
            ]),
          }),
          update: {
            $set: expect.objectContaining({
              channel: 'facebook',
              accountId: '123',
              token: 'TOKEN_A',
              organizationId: expect.anything(),
            }),
          },
          upsert: true,
        },
      }],
      { ordered: false },
    )
    expect(result).toMatchObject({
      syncedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      cacheTokenCount: 0,
      liveTokenCount: 1,
    })
  })

  it('does not overwrite an account already assigned to another organization', async () => {
    ;(FbToken.find as jest.Mock).mockResolvedValue([{
      _id: 'token_a',
      token: 'TOKEN_A',
      optimizer: 'opt-a',
      organizationId: { toString: () => '665000000000000000000001' },
    }])
    ;(FacebookUser.findOne as jest.Mock).mockReturnValue(queryResult(null))
    mockFetchUserAdAccounts.mockResolvedValue([{
      id: 'act_123',
      name: 'Account 123',
      account_status: 1,
    }])
    ;(Account.find as jest.Mock).mockReturnValue(queryResult([{
      accountId: '123',
      organizationId: { toString: () => '665000000000000000000002' },
    }]))
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({} as any)

    const result = await syncAccountsFromTokens()

    expect(Account.bulkWrite).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      syncedCount: 0,
      skippedCount: 1,
      errorCount: 0,
    })
    expect(result.errors[0]).toMatchObject({
      tokenId: 'token_a',
      error: '广告账户 123 已归属其他组织，跳过同步',
    })
  })

  it('treats a concurrent organization upsert conflict as a skipped account', async () => {
    ;(FbToken.find as jest.Mock).mockResolvedValue([{
      _id: 'token_a',
      token: 'TOKEN_A',
      organizationId: { toString: () => '665000000000000000000001' },
    }])
    ;(FacebookUser.findOne as jest.Mock).mockReturnValue(queryResult({
      adAccounts: [{ accountId: '123', name: 'Account 123', status: 1 }],
    }))
    ;(Account.find as jest.Mock).mockReturnValue(queryResult([]))
    ;(Account.bulkWrite as jest.Mock).mockRejectedValue({
      code: 11000,
      keyValue: { accountId: '123' },
      writeErrors: [{ code: 11000, index: 0 }],
    })
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({} as any)

    const result = await syncAccountsFromTokens()

    expect(result).toMatchObject({
      syncedCount: 0,
      skippedCount: 1,
      errorCount: 0,
    })
    expect(result.errors[0]).toMatchObject({
      tokenId: 'token_a',
      error: '广告账户 123 并发归属冲突，跳过同步',
    })
  })

  it('does not mark a token synced when unordered bulk writes have mixed failures', async () => {
    ;(FbToken.find as jest.Mock).mockResolvedValue([{
      _id: 'token_a',
      token: 'TOKEN_A',
      organizationId: { toString: () => '665000000000000000000001' },
    }])
    ;(FacebookUser.findOne as jest.Mock).mockReturnValue(queryResult({
      adAccounts: [
        { accountId: '123', name: 'Account 123', status: 1 },
        { accountId: '456', name: 'Account 456', status: 1 },
      ],
    }))
    ;(Account.find as jest.Mock).mockReturnValue(queryResult([]))
    ;(Account.bulkWrite as jest.Mock).mockRejectedValue({
      code: 11000,
      writeErrors: [
        { code: 11000, index: 0 },
        { code: 121, index: 1 },
      ],
    })

    const result = await syncAccountsFromTokens()

    expect(result).toMatchObject({
      syncedCount: 0,
      skippedCount: 0,
      errorCount: 1,
    })
    expect(FbToken.findByIdAndUpdate).not.toHaveBeenCalled()
  })
})
