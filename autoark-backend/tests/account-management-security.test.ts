import Account from '../src/models/Account'
import AccountGroup from '../src/models/AccountGroup'
import Organization from '../src/models/Organization'
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

  it('sanitizes bulk account ids before assigning accounts to an organization', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue({ name: 'Acme' } as any)
    const updateManySpy = jest.spyOn(Account, 'updateMany').mockResolvedValue({ modifiedCount: 1 } as any)

    const count = await accountManagementService.assignToOrganization(
      [' act_1 ', { $ne: 'act_2' } as any, '', null as any],
      ' 665000000000000000000001 ',
      {
        userId: 'admin',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(Organization.findById).toHaveBeenCalledWith('665000000000000000000001')
    expect(updateManySpy).toHaveBeenCalledWith(
      { accountId: { $in: ['act_1'] } },
      {
        $set: expect.objectContaining({
          organizationId: '665000000000000000000001',
          assignedBy: 'admin',
        }),
      },
    )
    expect(count).toBe(1)
  })

  it('caps bulk account ids before assigning accounts to an organization', async () => {
    jest.spyOn(Organization, 'findById').mockResolvedValue({ name: 'Acme' } as any)
    const updateManySpy = jest.spyOn(Account, 'updateMany').mockResolvedValue({ modifiedCount: 500 } as any)

    const accountIds = Array.from({ length: 700 }, (_, index) => `act_${index + 1}`)
    const count = await accountManagementService.assignToOrganization(
      accountIds,
      '665000000000000000000001',
      {
        userId: 'admin',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    const [query] = updateManySpy.mock.calls[0]
    expect(query.accountId.$in).toHaveLength(500)
    expect(query.accountId.$in[0]).toBe('act_1')
    expect(query.accountId.$in[499]).toBe('act_500')
    expect(count).toBe(500)
  })

  it('sanitizes account tags before saving them', async () => {
    const account: any = {
      tags: ['existing'],
      save: jest.fn().mockResolvedValue(undefined),
    }
    const findOneSpy = jest.spyOn(Account, 'findOne').mockReturnValue({
      select: jest.fn().mockResolvedValue(account),
    } as any)
    const longTag = 'x'.repeat(80)

    await accountManagementService.addTags(
      ' act_123 ',
      [' vip ', { $ne: 'bad' } as any, longTag],
      {
        userId: 'admin',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(findOneSpy).toHaveBeenCalledWith({ accountId: 'act_123' })
    expect(account.tags).toEqual(['existing', 'vip', longTag.slice(0, 30)])
    expect(account.save).toHaveBeenCalled()
  })

  it('sanitizes account notes before saving them', async () => {
    const account: any = {
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(Account, 'findOne').mockReturnValue({
      select: jest.fn().mockResolvedValue(account),
    } as any)
    const note = `  ${'n'.repeat(600)}  `

    await accountManagementService.updateAccountNotes(
      ' act_123 ',
      note,
      {
        userId: 'admin',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(account.notes).toBe('n'.repeat(500))
    expect(account.save).toHaveBeenCalled()
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
