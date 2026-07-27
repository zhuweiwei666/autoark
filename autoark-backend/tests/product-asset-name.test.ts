import {
  hasExactProductAssetName,
  parseProductAssetName,
  productIdentifierFromName,
} from '../src/utils/productAssetName'

describe('product asset name identity', () => {
  it('links the documented copy package and Pixel naming convention', () => {
    expect(parseProductAssetName('Leyon-autoark')).toEqual({
      key: 'leyon',
      displayName: 'Leyon',
      tokens: ['leyon'],
    })
    expect(parseProductAssetName('Leyon-ios-autoark')).toEqual({
      key: 'leyon',
      displayName: 'Leyon',
      tokens: ['leyon'],
    })
    expect(hasExactProductAssetName('Leyon-autoark', 'Leyon-ios-autoark')).toBe(
      true,
    )
  })

  it('preserves multi-word product names while removing trailing operations tags', () => {
    expect(parseProductAssetName('Cling AI-ios-autoark')).toMatchObject({
      key: 'cling ai',
      displayName: 'Cling AI',
    })
    expect(productIdentifierFromName('Cling AI-autoark')).toBe('name:cling-ai')
  })

  it('does not use substring or fuzzy matching', () => {
    expect(
      hasExactProductAssetName('Leyon Pro-autoark', 'Leyon-ios-autoark'),
    ).toBe(false)
    expect(
      hasExactProductAssetName('Leyon-autoark', 'Leyona-ios-autoark'),
    ).toBe(false)
  })

  it('rejects names made only from operational suffixes', () => {
    expect(parseProductAssetName('ios-autoark')).toBeNull()
    expect(parseProductAssetName('pixel')).toBeNull()
  })

  it('does not strip product words that can also describe an asset', () => {
    expect(parseProductAssetName('Cash App-autoark')).toMatchObject({
      key: 'cash app',
      displayName: 'Cash App',
    })
    expect(parseProductAssetName('Google Pixel-autoark')).toMatchObject({
      key: 'google pixel',
      displayName: 'Google Pixel',
    })
  })
})
