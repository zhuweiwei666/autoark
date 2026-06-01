import Account from '../src/models/Account'
import { UserRole } from '../src/models/User'
import accountManagementService from '../src/services/account.management.service'

const queryChain = () => {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockResolvedValue([]),
  }
  return chain
}

describe('account management security', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('removes account tokens from serialized API documents', () => {
    const account = new Account({
      channel: 'facebook',
      accountId: 'act_123',
      name: 'Secret account',
      token: 'EAA_REAL_FACEBOOK_TOKEN',
    })

    expect(account.toJSON()).toMatchObject({
      accountId: 'act_123',
      name: 'Secret account',
    })
    expect(account.toJSON()).not.toHaveProperty('token')
    expect(account.toObject()).not.toHaveProperty('token')
  })

  it('does not select account tokens for account management lists', async () => {
    const chain = queryChain()
    const findSpy = jest.spyOn(Account, 'find').mockReturnValue(chain as any)

    await accountManagementService.getAccounts({
      userId: 'admin',
      role: UserRole.SUPER_ADMIN,
    } as any, { channel: 'tiktok' })

    expect(findSpy).toHaveBeenCalledWith({ channel: 'tiktok' })
    expect(chain.select).toHaveBeenCalledWith('-token')
  })

  it('does not select account tokens for unassigned account pools', async () => {
    const chain = queryChain()
    jest.spyOn(Account, 'find').mockReturnValue(chain as any)

    await accountManagementService.getUnassignedAccounts({
      userId: 'admin',
      role: UserRole.SUPER_ADMIN,
    } as any)

    expect(chain.select).toHaveBeenCalledWith('-token')
  })
})
