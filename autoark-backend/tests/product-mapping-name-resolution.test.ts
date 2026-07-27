import Account from '../src/models/Account'
import CopywritingPackage from '../src/models/CopywritingPackage'
import FbToken from '../src/models/FbToken'
import Product from '../src/models/Product'
import { facebookClient } from '../src/integration/facebook/facebookClient'
import {
  matchProductsWithPixels,
  scanProductsFromCopyPackages,
} from '../src/services/productMapping.service'

describe('product mapping exact operational-name resolution', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('creates a Product from the copy package product-name prefix', async () => {
    const packageId = '665000000000000000000301'
    const createdProduct = {
      _id: '665000000000000000000302',
      name: 'Leyon',
      identifier: 'name:leyon',
      copywritingPackageIds: [packageId],
    }
    jest.spyOn(CopywritingPackage, 'find').mockResolvedValue([
      {
        _id: packageId,
        name: 'Leyon-autoark',
        links: { websiteUrl: 'https://leyon.example.com/offer' },
      },
    ] as never)
    jest.spyOn(Product, 'find').mockResolvedValue([] as never)
    jest
      .spyOn(Product, 'create')
      .mockResolvedValue(createdProduct as never)

    const result = await scanProductsFromCopyPackages(
      { organizationId: '665000000000000000000303' },
      { organizationId: '665000000000000000000303' },
    )

    expect(Product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Leyon',
        identifier: 'name:leyon',
        primaryDomain: 'leyon.example.com',
        copywritingPackageIds: [packageId],
      }),
    )
    expect(result).toEqual({ created: 1, updated: 0, errors: [] })
  })

  it('adds a unique exact-name Pixel only as an unverified candidate', async () => {
    const product: any = {
      _id: '665000000000000000000304',
      name: 'Leyon',
      primaryDomain: 'leyon.example.com',
      pixels: [],
      accounts: [],
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(Product, 'find').mockResolvedValue([product] as never)
    jest.spyOn(Account, 'find').mockResolvedValue([
      {
        accountId: 'act_456',
        name: 'AI Account',
        token: 'scoped-token',
      },
    ] as never)
    jest.spyOn(FbToken, 'find').mockResolvedValue([
      { _id: 'token_1', token: 'scoped-token', status: 'active' },
    ] as never)
    jest.spyOn(facebookClient, 'get').mockResolvedValue({
      data: [{ id: 'pixel_leyon', name: 'Leyon-ios-autoark' }],
    } as never)

    const result = await matchProductsWithPixels()

    expect(product.pixels).toEqual([
      expect.objectContaining({
        pixelId: 'pixel_leyon',
        pixelName: 'Leyon-ios-autoark',
        confidence: 100,
        matchMethod: 'auto_name',
        verified: false,
      }),
    ])
    expect(product.accounts).toEqual([
      expect.objectContaining({
        accountId: '456',
        throughPixelId: 'pixel_leyon',
      }),
    ])
    expect(product.save).toHaveBeenCalledTimes(1)
    expect(result.matched).toBe(1)
  })

  it('does not pick one when an account exposes multiple exact-name Pixels', async () => {
    const product: any = {
      _id: '665000000000000000000305',
      name: 'Leyon',
      primaryDomain: 'leyon.example.com',
      pixels: [],
      accounts: [],
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(Product, 'find').mockResolvedValue([product] as never)
    jest.spyOn(Account, 'find').mockResolvedValue([
      {
        accountId: 'act_456',
        name: 'AI Account',
        token: 'scoped-token',
      },
    ] as never)
    jest.spyOn(FbToken, 'find').mockResolvedValue([
      { _id: 'token_1', token: 'scoped-token', status: 'active' },
    ] as never)
    jest.spyOn(facebookClient, 'get').mockResolvedValue({
      data: [
        { id: 'pixel_ios', name: 'Leyon-ios-autoark' },
        { id: 'pixel_android', name: 'Leyon-android-autoark' },
      ],
    } as never)

    const result = await matchProductsWithPixels()

    expect(product.pixels).toEqual([])
    expect(product.save).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      matched: 0,
      unmatched: 1,
      details: [
        {
          confidence: 100,
          reason: 'ambiguous_best_match',
        },
      ],
    })
  })
})
