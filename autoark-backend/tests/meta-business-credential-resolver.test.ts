const mockCredentialFind = jest.fn()

jest.mock('../src/models/MetaBusinessCredential', () => ({
  __esModule: true,
  default: {
    find: mockCredentialFind,
  },
}))

import {
  credentialCoversAssets,
  resolveAccountOperationalAuthorization,
  resolveAccountOperationalAuthorizations,
  resolveAgentOperationalAuthorization,
  resolvePublishingCredential,
} from '../src/services/metaBusinessCredential.service'
import { encryptMetaToken } from '../src/utils/metaCredentialCrypto'

const queryResult = (credentials: any[]) => ({
  select: jest.fn().mockReturnValue({
    sort: jest.fn().mockResolvedValue(credentials),
  }),
})

describe('organization-scoped Meta publishing credential resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.META_CREDENTIAL_ENCRYPTION_KEY = 'resolver-test-key'
  })

  it('requires exact account, Page and Pixel grants before returning the decrypted token', async () => {
    const credential = {
      _id: '665000000000000000000010',
      tokenCiphertext: encryptMetaToken('SYSTEM_TOKEN'),
      assetGrants: {
        adAccounts: [{ assetId: '123' }],
        pages: [{ assetId: '456' }],
        pixels: [{ assetId: '789' }],
      },
    }
    mockCredentialFind.mockReturnValue(queryResult([credential]))

    const resolved = await resolvePublishingCredential({
      organizationId: '665000000000000000000001',
      adAccountIds: ['act_123'],
      pageIds: ['456'],
      pixelIds: ['789'],
    })

    expect(resolved?.token).toBe('SYSTEM_TOKEN')
    expect(mockCredentialFind).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: '665000000000000000000001',
      status: 'active',
      $or: expect.any(Array),
    }))
    expect(credentialCoversAssets(credential, {
      adAccountIds: ['act_123'],
      pageIds: ['456'],
      pixelIds: ['789'],
    })).toBe(true)
  })

  it('does not fall through to a credential missing any requested asset', async () => {
    mockCredentialFind.mockReturnValue(queryResult([{
      tokenCiphertext: encryptMetaToken('WRONG_TOKEN'),
      assetGrants: {
        adAccounts: [{ assetId: '123' }],
        pages: [],
        pixels: [],
      },
    }]))

    const resolved = await resolvePublishingCredential({
      organizationId: '665000000000000000000001',
      adAccountIds: ['123'],
      pageIds: ['not-granted'],
    })

    expect(resolved).toBeNull()
  })

  it('skips an unreadable default ciphertext and uses a healthy secondary credential', async () => {
    const grants = {
      adAccounts: [{ assetId: '123' }],
      pages: [],
      pixels: [],
    }
    mockCredentialFind.mockReturnValue(queryResult([
      { tokenCiphertext: 'v1:broken:value:ciphertext', assetGrants: grants },
      { tokenCiphertext: encryptMetaToken('SECONDARY_TOKEN'), assetGrants: grants },
    ]))

    const resolved = await resolvePublishingCredential({
      organizationId: '665000000000000000000001',
      adAccountIds: ['123'],
    })

    expect(resolved?.token).toBe('SECONDARY_TOKEN')
  })

  it('uses a covering System User before the supplied personal fallback', async () => {
    mockCredentialFind.mockReturnValue(queryResult([{
      _id: '665000000000000000000099',
      tokenCiphertext: encryptMetaToken('SYSTEM_TOKEN'),
      assetGrants: {
        adAccounts: [{ assetId: '123' }],
        pages: [],
        pixels: [],
      },
    }]))

    const resolved = await resolveAccountOperationalAuthorization({
      organizationId: '665000000000000000000001',
      accountId: 'act_123',
      legacyToken: 'PERSONAL_TOKEN',
      legacyTokenId: '665000000000000000000088',
    })

    expect(resolved).toEqual({
      authorizationType: 'system_user',
      token: 'SYSTEM_TOKEN',
      metaCredentialId: '665000000000000000000099',
    })
  })

  it('returns the covering System User and personal fallback as ordered retry candidates', async () => {
    mockCredentialFind.mockReturnValue(queryResult([{
      _id: '665000000000000000000099',
      tokenCiphertext: encryptMetaToken('SYSTEM_TOKEN'),
      assetGrants: {
        adAccounts: [{ assetId: '123' }],
        pages: [],
        pixels: [],
      },
    }]))

    const resolved = await resolveAccountOperationalAuthorizations({
      organizationId: '665000000000000000000001',
      accountId: 'act_123',
      legacyToken: 'PERSONAL_TOKEN',
      legacyTokenId: '665000000000000000000088',
    })

    expect(resolved).toEqual([
      {
        authorizationType: 'system_user',
        token: 'SYSTEM_TOKEN',
        metaCredentialId: '665000000000000000000099',
      },
      {
        authorizationType: 'personal',
        token: 'PERSONAL_TOKEN',
        legacyTokenId: '665000000000000000000088',
      },
    ])
  })

  it('uses the explicitly supplied personal token only when no System User is available', async () => {
    mockCredentialFind.mockReturnValue(queryResult([]))

    const resolved = await resolveAccountOperationalAuthorization({
      organizationId: '665000000000000000000001',
      accountId: '123',
      legacyToken: 'PERSONAL_TOKEN',
      legacyTokenId: '665000000000000000000088',
    })

    expect(resolved).toEqual({
      authorizationType: 'personal',
      token: 'PERSONAL_TOKEN',
      legacyTokenId: '665000000000000000000088',
    })
  })

  it('uses a System User for the exact agent account scope', async () => {
    mockCredentialFind.mockReturnValue(queryResult([{
      _id: '665000000000000000000099',
      tokenCiphertext: encryptMetaToken('SYSTEM_TOKEN'),
      assetGrants: {
        adAccounts: [{ assetId: '123' }, { assetId: '456' }],
        pages: [],
        pixels: [],
      },
    }]))

    const resolved = await resolveAgentOperationalAuthorization({
      organizationId: '665000000000000000000001',
      adAccountIds: ['act_123', '456'],
      legacyTokenIds: ['665000000000000000000088'],
    })

    expect(resolved).toEqual({
      authorizationType: 'system_user',
      token: 'SYSTEM_TOKEN',
      metaCredentialId: '665000000000000000000099',
    })
  })
})
