jest.mock('../src/services/metaBusinessCredential.service', () => ({
  resolvePublishingCredential: jest.fn(),
}))

import {
  buildNamePixelMatch,
  productCandidatesForCopy,
} from '../src/services/optimizerExecution.service'

const copyPackage = {
  _id: '665000000000000000000101',
  name: 'Leyon-autoark',
  links: { websiteUrl: 'https://example.com/leyon' },
}

describe('AI optimizer name-based product and Pixel resolution', () => {
  it('resolves an existing Product by the exact normalized package name', () => {
    const result = productCandidatesForCopy(copyPackage, [
      {
        _id: '665000000000000000000102',
        name: 'Leyon',
        identifier: 'legacy-url-identifier',
        copywritingPackageIds: [],
      },
      {
        _id: '665000000000000000000103',
        name: 'Leyon Pro',
        copywritingPackageIds: [],
      },
    ])

    expect(result.mode).toBe('package_name')
    expect(result.products).toHaveLength(1)
    expect(result.products[0].name).toBe('Leyon')
  })

  it('offers one exact Pixel candidate per unambiguous execution account', () => {
    const result = buildNamePixelMatch(copyPackage, [
      {
        tokenId: 'token_1',
        authorizationType: 'system_user',
        fbUserName: 'AI Publisher',
        accounts: [
          {
            accountId: 'act_123',
            name: 'AI Account',
            pixels: [
              {
                pixelId: 'pixel_leyon',
                name: 'Leyon-ios-autoark',
              },
              {
                pixelId: 'pixel_other',
                name: 'Other-ios-autoark',
              },
            ],
          },
        ],
      },
    ])

    expect(result).toMatchObject({
      status: 'candidates',
      productKey: 'leyon',
      productName: 'Leyon',
      candidates: [
        {
          tokenId: 'token_1',
          accountId: '123',
          pixelId: 'pixel_leyon',
          pixelName: 'Leyon-ios-autoark',
          confidence: 100,
          matchMethod: 'exact_normalized_name',
        },
      ],
      ambiguousAccounts: [],
    })
  })

  it('rejects an account when more than one Pixel has the same product key', () => {
    const result = buildNamePixelMatch(copyPackage, [
      {
        tokenId: 'token_1',
        accounts: [
          {
            accountId: '123',
            name: 'AI Account',
            pixels: [
              { pixelId: 'pixel_a', name: 'Leyon-ios-autoark' },
              { pixelId: 'pixel_b', name: 'Leyon-android-autoark' },
            ],
          },
        ],
      },
    ])

    expect(result.status).toBe('ambiguous')
    expect(result.candidates).toEqual([])
    expect(result.ambiguousAccounts).toEqual([
      expect.objectContaining({
        accountId: '123',
        pixels: [
          { pixelId: 'pixel_a', pixelName: 'Leyon-ios-autoark' },
          { pixelId: 'pixel_b', pixelName: 'Leyon-android-autoark' },
        ],
      }),
    ])
  })

  it('does not recommend a fuzzy or substring Pixel name', () => {
    const result = buildNamePixelMatch(copyPackage, [
      {
        tokenId: 'token_1',
        accounts: [
          {
            accountId: '123',
            pixels: [
              { pixelId: 'pixel_a', name: 'Leyon Pro-ios-autoark' },
              { pixelId: 'pixel_b', name: 'Leyona-ios-autoark' },
            ],
          },
        ],
      },
    ])

    expect(result.status).toBe('not_found')
    expect(result.candidates).toEqual([])
  })
})
