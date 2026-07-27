import Account from '../src/models/Account'
import FbToken from '../src/models/FbToken'
import MetaBusinessCredential from '../src/models/MetaBusinessCredential'
import { getUserAccountIds } from '../src/middlewares/auth'
import { UserRole } from '../src/models/User'

const leanQuery = (value: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
})

describe('System User account access scope', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('keeps organization accounts accessible when the member has no personal token', async () => {
    const credentialFind = jest.spyOn(MetaBusinessCredential, 'find').mockReturnValue(
      leanQuery([
        {
          assetGrants: {
            adAccounts: [
              { assetId: 'act_123' },
              { assetId: '456' },
              { assetId: '123' },
            ],
          },
        },
      ]) as any,
    )
    jest.spyOn(FbToken, 'find').mockReturnValue(leanQuery([]) as any)
    const accountFind = jest.spyOn(Account, 'find')

    const result = await getUserAccountIds({
      user: {
        role: UserRole.MEMBER,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
    } as any)

    expect(result).toEqual(['123', '456'])
    expect(accountFind).not.toHaveBeenCalled()
    expect(credentialFind).toHaveBeenCalledWith({
      organizationId: '665000000000000000000001',
      status: 'active',
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: expect.any(Date) } },
      ],
    })
  })

  it('returns the deduplicated union of System User and personal-token accounts', async () => {
    jest.spyOn(MetaBusinessCredential, 'find').mockReturnValue(
      leanQuery([
        {
          assetGrants: {
            adAccounts: [{ assetId: 'act_123' }],
          },
        },
      ]) as any,
    )
    jest.spyOn(FbToken, 'find').mockReturnValue(
      leanQuery([{ token: 'personal-token' }]) as any,
    )
    jest.spyOn(Account, 'find').mockReturnValue(
      leanQuery([
        { accountId: '123' },
        { accountId: 'act_789' },
      ]) as any,
    )

    const result = await getUserAccountIds({
      user: {
        role: UserRole.ORG_ADMIN,
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
      },
    } as any)

    expect(result).toEqual(['123', '789'])
  })
})
