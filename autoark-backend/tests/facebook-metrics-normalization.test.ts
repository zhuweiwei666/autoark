import { parseFacebookPurchaseRoas } from '../src/utils/facebookMetrics'

describe('Facebook metric normalization', () => {
  it('extracts purchase ROAS from Meta array and scalar response shapes', () => {
    expect(parseFacebookPurchaseRoas([
      { action_type: 'omni_purchase', value: '2.75' },
    ])).toBe(2.75)
    expect(parseFacebookPurchaseRoas('1.5')).toBe(1.5)
    expect(parseFacebookPurchaseRoas(3)).toBe(3)
  })

  it('never returns a non-finite number for malformed provider data', () => {
    expect(parseFacebookPurchaseRoas([{ action_type: 'omni_purchase', value: 'not-a-number' }])).toBe(0)
    expect(parseFacebookPurchaseRoas(Number.NaN)).toBe(0)
    expect(parseFacebookPurchaseRoas(Number.POSITIVE_INFINITY)).toBe(0)
    expect(parseFacebookPurchaseRoas(undefined)).toBe(0)
  })
})
