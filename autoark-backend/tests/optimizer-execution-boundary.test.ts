const mockResolvePublishingCredential = jest.fn()

jest.mock('../src/services/metaBusinessCredential.service', () => ({
  resolvePublishingCredential: mockResolvePublishingCredential,
}))

import Account from '../src/models/Account'
import AiExecutionMandate from '../src/models/AiExecutionMandate'
import CopywritingPackage from '../src/models/CopywritingPackage'
import CreativeGroup from '../src/models/CreativeGroup'
import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import MetaBusinessCredential from '../src/models/MetaBusinessCredential'
import PlaybookVersion from '../src/models/PlaybookVersion'
import Product from '../src/models/Product'
import TargetingPackage from '../src/models/TargetingPackage'
import {
  assertSourceExecutionIsolation,
  createExecutionMandate,
} from '../src/services/optimizerExecution.service'

const playbook = {
  source: {
    tokenIds: ['665000000000000000000001'],
    accountIds: ['act_123'],
  },
}

describe('AI execution source isolation', () => {
  it('never allows a human-buyer source token to become an execution token', () => {
    expect(() =>
      assertSourceExecutionIsolation({
        playbook,
        facebookTokenId: '665000000000000000000001',
        accountIds: ['456'],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'AI_SOURCE_TOKEN_FORBIDDEN',
        statusCode: 409,
      }),
    )
  })

  it('never allows a human-buyer source account to become an execution account', () => {
    expect(() =>
      assertSourceExecutionIsolation({
        playbook,
        facebookTokenId: '665000000000000000000002',
        accountIds: ['123'],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'AI_SOURCE_ACCOUNT_FORBIDDEN',
        statusCode: 409,
      }),
    )
  })

  it('also isolates source tokens carried by reusable assets from another playbook', () => {
    expect(() =>
      assertSourceExecutionIsolation({
        playbook,
        facebookTokenId: '665000000000000000000009',
        accountIds: ['456'],
        extraSourceTokenIds: ['665000000000000000000009'],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'AI_SOURCE_TOKEN_FORBIDDEN',
      }),
    )
  })

  it('accepts a dedicated admin-assigned token and account', () => {
    expect(
      assertSourceExecutionIsolation({
        playbook,
        facebookTokenId: '665000000000000000000002',
        accountIds: ['456'],
      }),
    ).toMatchObject({
      mode: 'read_only_context',
      tokenIds: ['665000000000000000000001'],
      accountIds: ['123'],
      inheritedAssetsAllowed: false,
    })
  })
})

const ids = {
  organization: '665000000000000000000010',
  playbook: '665000000000000000000011',
  sourceToken: '665000000000000000000012',
  executionToken: '665000000000000000000013',
  metaCredential: '66500000000000000000001a',
  targeting: '665000000000000000000014',
  creative: '665000000000000000000015',
  copy: '665000000000000000000016',
  product: '665000000000000000000017',
  mandate: '665000000000000000000018',
}

const queryWithLean = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const queryWithSelectAndLean = (value: any) => ({
  select: jest.fn().mockReturnValue(queryWithLean(value)),
})

const setupMandateDependencies = ({
  verified = true,
  systemUser = false,
}: {
  verified?: boolean
  systemUser?: boolean
} = {}) => {
  const playbookDocument = {
    _id: ids.playbook,
    organizationId: ids.organization,
    scopeKey: `org:${ids.organization}`,
    optimizerId: 'human_buyer_a',
    version: 3,
    eligibility: { eligible: true },
    source: {
      tokenIds: [ids.sourceToken],
      accountIds: ['123'],
      currencies: ['USD'],
    },
    guardrails: {
      suggestedPilotDailyBudget: 20,
      maximumPilotDailyBudget: 50,
    },
  }
  const token = {
    _id: ids.executionToken,
    userId: '665000000000000000000019',
    status: 'active',
  }
  const targetingPackage = {
    _id: ids.targeting,
    reusePolicy: { scope: 'portable' },
    portableTargeting: { geo_locations: { countries: ['US'] } },
    sourceContext: {
      tokenIds: [ids.sourceToken],
      accountIds: ['123'],
    },
  }
  const creativeGroup = {
    _id: ids.creative,
    reusePolicy: { scope: 'portable' },
    materials: [
      {
        type: 'image',
        url: 'https://cdn.example.com/winner.jpg',
      },
    ],
    sourceContext: {
      tokenIds: [ids.sourceToken],
      accountIds: ['123'],
    },
  }
  const copywritingPackage = {
    _id: ids.copy,
    name: 'Admin product copy',
    links: { websiteUrl: 'https://product.example.com/offer' },
  }
  const product = {
    _id: ids.product,
    name: 'Admin Product',
    identifier: 'admin-product',
    copywritingPackageIds: [ids.copy],
    accounts: [
      {
        accountId: '456',
        status: 'active',
        throughPixelId: 'pixel_456',
      },
    ],
    pixels: [
      {
        pixelId: 'pixel_456',
        pixelName: 'Product Purchase',
        verified,
      },
    ],
    defaultConfig: { pixelEvent: 'PURCHASE' },
  }
  const snapshot = {
    tokenId: ids.executionToken,
    syncStatus: 'completed',
    adAccounts: [
      {
        accountId: 'act_456',
        name: 'AI Account',
        status: 1,
        currency: 'USD',
        timezone: 'America/Los_Angeles',
      },
    ],
    pages: [
      {
        pageId: 'page_456',
        name: 'AI Page',
        accounts: [{ accountId: 'act_456' }],
      },
    ],
    pixels: [
      {
        pixelId: 'pixel_456',
        name: 'Product Purchase',
        accounts: [{ accountId: 'act_456' }],
      },
    ],
  }

  jest
    .spyOn(PlaybookVersion, 'findOne')
    .mockReturnValue(queryWithLean(playbookDocument) as any)
  if (systemUser) {
    const credential = {
      _id: ids.metaCredential,
      organizationId: ids.organization,
      status: 'active',
      systemUserId: 'system_user_1',
      systemUserName: 'AutoArk AI Publisher',
      assetGrants: {
        adAccounts: [
          {
            assetId: '456',
            name: 'AI Account',
            accountStatus: 1,
            currency: 'USD',
            timezoneName: 'America/Los_Angeles',
          },
        ],
        pages: [{ assetId: 'page_456', name: 'AI Page' }],
        pixels: [
          {
            assetId: 'pixel_456',
            name: 'Product Purchase',
            accountIds: ['456'],
          },
        ],
      },
    }
    jest
      .spyOn(MetaBusinessCredential, 'findOne')
      .mockReturnValue(queryWithLean(credential) as any)
    mockResolvePublishingCredential.mockResolvedValue({
      credential,
      token: 'redacted-system-token',
    })
  } else {
    jest.spyOn(FbToken, 'findOne').mockReturnValue(queryWithLean(token) as any)
  }
  jest
    .spyOn(TargetingPackage, 'findOne')
    .mockResolvedValue(targetingPackage as any)
  jest.spyOn(CreativeGroup, 'findOne').mockResolvedValue(creativeGroup as any)
  jest
    .spyOn(CopywritingPackage, 'findOne')
    .mockReturnValue(queryWithLean(copywritingPackage) as any)
  if (!systemUser) {
    jest
      .spyOn(FacebookUser, 'find')
      .mockReturnValue(queryWithLean([snapshot]) as any)
  }
  jest.spyOn(Product, 'find').mockReturnValue(queryWithLean([product]) as any)
  jest.spyOn(Account, 'find').mockReturnValue(
    queryWithSelectAndLean([
      {
        accountId: '456',
        name: 'AI Account',
        status: 'active',
      },
    ]) as any,
  )
  jest.spyOn(AiExecutionMandate, 'create').mockImplementation(
    async (document: any) =>
      ({
        ...document,
        _id: ids.mandate,
        toObject: () => ({ ...document, _id: ids.mandate }),
      }) as any,
  )
}

describe('AI execution mandate product and Pixel resolution', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('derives the execution Pixel from the admin product mapping', async () => {
    setupMandateDependencies()

    const mandate: any = await createExecutionMandate({
      playbookId: ids.playbook,
      facebookTokenId: ids.executionToken,
      accounts: [{ accountId: '456', pageId: 'page_456' }],
      targetingPackageId: ids.targeting,
      creativeGroupId: ids.creative,
      copywritingPackageId: ids.copy,
      createdBy: '665000000000000000000019',
    })

    expect(mandate).toMatchObject({
      facebookTokenId: ids.executionToken,
      copywritingPackageId: ids.copy,
      productId: ids.product,
      permissions: {
        metaWriteMode: 'paused_only',
        automaticActivationAllowed: false,
      },
      accounts: [
        {
          accountId: '456',
          pageId: 'page_456',
          pixelId: 'pixel_456',
          conversionEvent: 'PURCHASE',
        },
      ],
    })
  })

  it('fails closed when the product Pixel has not been admin-verified', async () => {
    setupMandateDependencies({ verified: false })

    await expect(
      createExecutionMandate({
        playbookId: ids.playbook,
        facebookTokenId: ids.executionToken,
        accounts: [{ accountId: '456', pageId: 'page_456' }],
        targetingPackageId: ids.targeting,
        creativeGroupId: ids.creative,
        copywritingPackageId: ids.copy,
        createdBy: '665000000000000000000019',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERIFIED_PRODUCT_PIXEL_REQUIRED',
    })
    expect(AiExecutionMandate.create).not.toHaveBeenCalled()
  })

  it('binds an organization System User without exposing or reusing a human token', async () => {
    setupMandateDependencies({ systemUser: true })
    const personalTokenLookup = jest.spyOn(FbToken, 'findOne')
    const personalSnapshotLookup = jest.spyOn(FacebookUser, 'find')

    const mandate: any = await createExecutionMandate({
      playbookId: ids.playbook,
      authorizationType: 'system_user',
      metaCredentialId: ids.metaCredential,
      accounts: [{ accountId: '456', pageId: 'page_456' }],
      targetingPackageId: ids.targeting,
      creativeGroupId: ids.creative,
      copywritingPackageId: ids.copy,
      createdBy: '665000000000000000000019',
    })

    expect(mandate).toMatchObject({
      authorizationType: 'system_user',
      metaCredentialId: ids.metaCredential,
      accounts: [
        expect.objectContaining({
          accountId: '456',
          pageId: 'page_456',
          pixelId: 'pixel_456',
        }),
      ],
    })
    expect(mandate.facebookTokenId).toBeUndefined()
    expect(personalTokenLookup).not.toHaveBeenCalled()
    expect(personalSnapshotLookup).not.toHaveBeenCalled()
    expect(mockResolvePublishingCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: ids.metaCredential,
        adAccountIds: ['456'],
        pageIds: ['page_456'],
        pixelIds: ['pixel_456'],
      }),
    )
  })
})
