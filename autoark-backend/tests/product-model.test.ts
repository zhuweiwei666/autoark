import Product from '../src/models/Product'

describe('Product model helpers', () => {
  it('matches active ad accounts regardless of act_ prefix', () => {
    const product: any = new Product({
      name: 'Demo product',
      identifier: 'demo-product',
      accounts: [
        { accountId: '123', status: 'active' },
        { accountId: 'act_456', status: 'inactive' },
      ],
    })

    expect(product.canAdvertiseWith('act_123')).toBe(true)
    expect(product.canAdvertiseWith('123')).toBe(true)
    expect(product.canAdvertiseWith('act_456')).toBe(false)
    expect(product.canAdvertiseWith('')).toBe(false)
  })

  it('returns normalized account IDs for automatic ad creation', () => {
    const product: any = new Product({
      name: 'Demo product',
      identifier: 'demo-product',
      accounts: [
        { accountId: 'act_456', status: 'active', adCount: 0 },
        { accountId: '789', status: 'active', adCount: 3 },
      ],
    })

    expect(product.getBestAccount()).toBe('456')
  })
})
