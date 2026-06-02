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

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}))

import Account from '../src/models/Account'
import FbToken from '../src/models/FbToken'
import { syncAccountsFromTokens } from '../src/services/facebook.accounts.service'

const findOneResult = (result: any) => ({
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
    mockFetchUserAdAccounts.mockResolvedValue([{
      id: 'act_123',
      name: 'Account 123',
      account_status: 1,
    }])
    ;(Account.findOne as jest.Mock).mockReturnValue(findOneResult(null))
    ;(Account.findOneAndUpdate as jest.Mock).mockResolvedValue({} as any)
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({} as any)

    const result = await syncAccountsFromTokens()

    expect(Account.findOne).toHaveBeenCalledWith({
      channel: 'facebook',
      accountId: '123',
    })
    expect(Account.findOneAndUpdate).toHaveBeenCalledWith(
      { channel: 'facebook', accountId: '123' },
      expect.objectContaining({
        channel: 'facebook',
        accountId: '123',
        token: 'TOKEN_A',
        organizationId: expect.anything(),
      }),
      { upsert: true, new: true },
    )
    expect(result).toMatchObject({
      syncedCount: 1,
      skippedCount: 0,
      errorCount: 0,
    })
  })

  it('does not overwrite an account already assigned to another organization', async () => {
    ;(FbToken.find as jest.Mock).mockResolvedValue([{
      _id: 'token_a',
      token: 'TOKEN_A',
      optimizer: 'opt-a',
      organizationId: { toString: () => '665000000000000000000001' },
    }])
    mockFetchUserAdAccounts.mockResolvedValue([{
      id: 'act_123',
      name: 'Account 123',
      account_status: 1,
    }])
    ;(Account.findOne as jest.Mock).mockReturnValue(findOneResult({
      organizationId: { toString: () => '665000000000000000000002' },
    }))
    ;(FbToken.findByIdAndUpdate as jest.Mock).mockResolvedValue({} as any)

    const result = await syncAccountsFromTokens()

    expect(Account.findOneAndUpdate).not.toHaveBeenCalled()
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
})
