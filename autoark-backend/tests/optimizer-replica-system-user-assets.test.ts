import mongoose from 'mongoose'
import Account from '../src/models/Account'
import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import MetaBusinessCredential from '../src/models/MetaBusinessCredential'
import PlaybookVersion from '../src/models/PlaybookVersion'
import { listReplicaAssets } from '../src/services/optimizerReplica.service'

const selectLeanQuery = (value: any) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
})

describe('optimizer replica System User assets', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('offers the organization System User before personal-token snapshots', async () => {
    const organizationId = new mongoose.Types.ObjectId('665000000000000000000001')
    const playbookId = new mongoose.Types.ObjectId('665000000000000000000002')
    const credentialId = new mongoose.Types.ObjectId('665000000000000000000003')
    jest.spyOn(PlaybookVersion, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: playbookId,
        organizationId,
      }),
    } as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(selectLeanQuery([]) as any)
    const personalSnapshotFind = jest.spyOn(FacebookUser, 'find')
    jest.spyOn(MetaBusinessCredential, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: credentialId,
            organizationId,
            status: 'active',
            systemUserId: 'su_1',
            systemUserName: 'AutoArk Publisher',
            lastReconciledAt: new Date('2026-07-27T00:00:00.000Z'),
            assetGrants: {
              adAccounts: [{
                assetId: '123',
                name: 'Account 123',
                accountStatus: 1,
                currency: 'USD',
              }],
              pages: [{ assetId: 'page_1', name: 'Page 1' }],
              pixels: [{
                assetId: 'pixel_1',
                name: 'Pixel 1',
                accountIds: ['123'],
              }],
            },
          },
        ]),
      }),
    } as any)
    jest.spyOn(Account, 'find').mockReturnValue(
      selectLeanQuery([{
        accountId: '123',
        name: 'Account 123',
        status: 'active',
        currency: 'USD',
        organizationId,
      }]) as any,
    )

    const result = await listReplicaAssets({
      playbookId: String(playbookId),
      accessFilter: { organizationId },
      tokenAccessFilter: { organizationId },
    })

    expect(personalSnapshotFind).not.toHaveBeenCalled()
    expect(result.tokens).toEqual([
      expect.objectContaining({
        tokenId: String(credentialId),
        authorizationType: 'system_user',
        metaCredentialId: String(credentialId),
        fbUserName: 'AutoArk Publisher',
        accounts: [{
          accountId: '123',
          name: 'Account 123',
          status: 1,
          currency: 'USD',
          pages: [{ pageId: 'page_1', name: 'Page 1' }],
          pixels: [{ pixelId: 'pixel_1', name: 'Pixel 1' }],
        }],
      }),
    ])
    expect(JSON.stringify(result)).not.toContain('access_token')
  })
})
