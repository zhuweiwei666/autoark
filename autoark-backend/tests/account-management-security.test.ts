import Account from '../src/models/Account'
import AccountGroup from '../src/models/AccountGroup'
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

  it('sanitizes account management list filters before querying', async () => {
    const chain = queryChain()
    const findSpy = jest.spyOn(Account, 'find').mockReturnValue(chain as any)

    await accountManagementService.getAccounts({
      userId: 'admin',
      role: UserRole.SUPER_ADMIN,
    } as any, {
      channel: { $ne: 'facebook' },
      organizationId: { $ne: '665000000000000000000001' },
      tags: [{ $ne: 'vip' }, ' vip ', 'agency.a+'],
      groupId: { $ne: '665000000000000000000701' },
      unassigned: 'false',
    })

    expect(findSpy).toHaveBeenCalledWith({
      tags: { $in: ['vip', 'agency.a+'] },
    })
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

  it('rejects group account ids outside the requester organization scope', async () => {
    jest.spyOn(AccountGroup, 'findOne').mockResolvedValue(null as any)
    jest.spyOn(AccountGroup.prototype, 'save').mockResolvedValue(undefined as any)
    jest.spyOn(Account, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ accountId: 'act_1' }]),
      }),
    } as any)
    const updateManySpy = jest.spyOn(Account, 'updateMany').mockResolvedValue({ modifiedCount: 0 } as any)

    await expect(accountManagementService.createGroup(
      {
        name: 'Org group',
        accounts: ['act_1', 'act_other_org'],
      },
      {
        userId: 'org_admin',
        role: UserRole.ORG_ADMIN,
        organizationId: '665000000000000000000001',
      } as any,
    )).rejects.toThrow('分组包含不存在或无权访问的账户')

    expect(Account.find).toHaveBeenCalledWith({
      accountId: { $in: ['act_1', 'act_other_org'] },
      organizationId: '665000000000000000000001',
    })
    expect(AccountGroup.prototype.save).not.toHaveBeenCalled()
    expect(updateManySpy).not.toHaveBeenCalled()
  })

  it('stores only validated scoped account ids in account groups', async () => {
    jest.spyOn(AccountGroup, 'findOne').mockResolvedValue(null as any)
    jest.spyOn(AccountGroup.prototype, 'save').mockImplementation(function saveMock(this: any) {
      this._id = this._id || '665000000000000000000701'
      return Promise.resolve(this)
    } as any)
    jest.spyOn(Account, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { accountId: 'act_1' },
          { accountId: 'act_2' },
        ]),
      }),
    } as any)
    const updateManySpy = jest.spyOn(Account, 'updateMany').mockResolvedValue({ modifiedCount: 2 } as any)

    const group: any = await accountManagementService.createGroup(
      {
        name: 'Org group',
        accounts: ['act_1', 'act_1', 'act_2'],
      },
      {
        userId: 'org_admin',
        role: UserRole.ORG_ADMIN,
        organizationId: '665000000000000000000001',
      } as any,
    )

    expect(group.accounts).toEqual(['act_1', 'act_2'])
    expect(Account.find).toHaveBeenCalledWith({
      accountId: { $in: ['act_1', 'act_2'] },
      organizationId: '665000000000000000000001',
    })
    expect(updateManySpy).toHaveBeenCalledWith(
      {
        accountId: { $in: ['act_1', 'act_2'] },
        organizationId: '665000000000000000000001',
      },
      { $set: { groupId: group._id } },
    )
  })
})
