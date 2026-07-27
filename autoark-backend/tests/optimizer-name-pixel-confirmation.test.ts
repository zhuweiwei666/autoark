const mockResolvePublishingCredential = jest.fn()

jest.mock('../src/services/metaBusinessCredential.service', () => ({
  resolvePublishingCredential: mockResolvePublishingCredential,
}))

import AiExecutionMandate from '../src/models/AiExecutionMandate'
import CopywritingPackage from '../src/models/CopywritingPackage'
import CreativeGroup from '../src/models/CreativeGroup'
import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import MetaBusinessCredential from '../src/models/MetaBusinessCredential'
import PlaybookVersion from '../src/models/PlaybookVersion'
import Product from '../src/models/Product'
import TargetingPackage from '../src/models/TargetingPackage'
import { confirmNameMatchedPixel } from '../src/services/optimizerExecution.service'

const ids = {
  organization: '665000000000000000000201',
  playbook: '665000000000000000000202',
  sourceToken: '665000000000000000000203',
  executionToken: '665000000000000000000204',
  copy: '665000000000000000000205',
  product: '665000000000000000000206',
}

const queryWithLean = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const queryWithSelectAndLean = (value: any) => ({
  select: jest.fn().mockReturnValue(queryWithLean(value)),
})

const queryWithSortLimitLean = (value: any) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
})

describe('admin confirmation of an exact package-to-Pixel name match', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('creates the Product hub and persists a verified Pixel/account mapping', async () => {
    const copyPackage = {
      _id: ids.copy,
      name: 'Leyon-autoark',
      links: { websiteUrl: 'https://leyon.example.com/offer' },
    }
    const createdProduct: any = {
      _id: ids.product,
      name: 'Leyon',
      identifier: 'name:leyon',
      status: 'active',
      copywritingPackageIds: [ids.copy],
      pixels: [],
      accounts: [],
      save: jest.fn().mockResolvedValue(undefined),
    }

    jest.spyOn(PlaybookVersion, 'findOne').mockReturnValue(
      queryWithLean({
        _id: ids.playbook,
        organizationId: ids.organization,
        source: {
          tokenIds: [ids.sourceToken],
          accountIds: ['123'],
        },
      }) as any,
    )
    jest.spyOn(FbToken, 'find').mockReturnValue(
      queryWithSelectAndLean([
        {
          _id: ids.executionToken,
          status: 'active',
          fbUserName: 'AI Publisher',
        },
      ]) as any,
    )
    jest
      .spyOn(MetaBusinessCredential, 'find')
      .mockReturnValue(queryWithSortLimitLean([]) as any)
    jest
      .spyOn(TargetingPackage, 'find')
      .mockReturnValue(queryWithSortLimitLean([]) as any)
    jest
      .spyOn(CreativeGroup, 'find')
      .mockReturnValue(queryWithSortLimitLean([]) as any)
    jest
      .spyOn(CopywritingPackage, 'find')
      .mockReturnValue(queryWithSortLimitLean([copyPackage]) as any)
    jest
      .spyOn(CopywritingPackage, 'findOne')
      .mockReturnValue(queryWithLean(copyPackage) as any)
    jest
      .spyOn(Product, 'find')
      .mockImplementationOnce(() => queryWithSelectAndLean([]) as any)
      .mockResolvedValueOnce([] as never)
    jest.spyOn(Product, 'findOne').mockResolvedValue(null as never)
    jest.spyOn(Product, 'create').mockResolvedValue(createdProduct as never)
    jest
      .spyOn(AiExecutionMandate, 'find')
      .mockReturnValue(queryWithSortLimitLean([]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(
      queryWithLean([
        {
          tokenId: ids.executionToken,
          syncStatus: 'completed',
          adAccounts: [
            {
              accountId: 'act_456',
              name: 'Dedicated AI Account',
              status: 1,
              currency: 'USD',
            },
          ],
          pages: [
            {
              pageId: 'page_456',
              accounts: [{ accountId: 'act_456' }],
            },
          ],
          pixels: [
            {
              pixelId: 'pixel_leyon',
              name: 'Leyon-ios-autoark',
              accounts: [{ accountId: 'act_456' }],
            },
          ],
        },
      ]) as any,
    )

    const result = await confirmNameMatchedPixel({
      playbookId: ids.playbook,
      copywritingPackageId: ids.copy,
      tokenId: ids.executionToken,
      accountId: 'act_456',
      pixelId: 'pixel_leyon',
      confirmedBy: 'admin_1',
      accessFilter: { organizationId: ids.organization },
      tokenAccessFilter: { organizationId: ids.organization },
    })

    expect(Product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Leyon',
        identifier: 'name:leyon',
        organizationId: ids.organization,
        primaryDomain: 'leyon.example.com',
        copywritingPackageIds: [ids.copy],
      }),
    )
    expect(createdProduct.pixels).toEqual([
      expect.objectContaining({
        pixelId: 'pixel_leyon',
        pixelName: 'Leyon-ios-autoark',
        confidence: 100,
        matchMethod: 'manual',
        verified: true,
        verifiedBy: 'admin_1',
      }),
    ])
    expect(createdProduct.accounts).toEqual([
      expect.objectContaining({
        accountId: '456',
        accountName: 'Dedicated AI Account',
        throughPixelId: 'pixel_leyon',
        status: 'active',
      }),
    ])
    expect(createdProduct.primaryPixelId).toBe('pixel_leyon')
    expect(createdProduct.save).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      productId: ids.product,
      productName: 'Leyon',
      accountId: '456',
      pixelId: 'pixel_leyon',
      verified: true,
    })
  })
})
