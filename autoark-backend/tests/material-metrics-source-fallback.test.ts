jest.mock('../src/models/RawInsights', () => ({
  __esModule: true,
  default: {},
}))

import { mergeDailyMaterialMetricSources } from '../src/services/materialMetrics.service'

describe('material metrics source fallback', () => {
  it('uses RawInsights when MetricsDaily is missing and normalizes spend/actions', () => {
    const result = mergeDailyMaterialMetricSources([], [{
      adId: 'ad-raw',
      country: 'US',
      spend: 12.5,
      actions: [{ action_type: 'purchase', value: '2' }],
    }])

    expect(result).toEqual([
      expect.objectContaining({
        adId: 'ad-raw',
        spendUsd: 12.5,
        raw: expect.objectContaining({
          actions: [{ action_type: 'purchase', value: '2' }],
        }),
      }),
    ])
  })

  it('prefers MetricsDaily over RawInsights for the same ad and country', () => {
    const result = mergeDailyMaterialMetricSources(
      [{ adId: 'ad-shared', country: 'US', spendUsd: 20 }],
      [{ adId: 'ad-shared', country: 'US', spend: 10 }],
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ spendUsd: 20 })
  })

  it('keeps cross-account ads as separate metric rows', () => {
    const result = mergeDailyMaterialMetricSources([], [
      { adId: 'ad-account-a', country: 'US', spend: 10 },
      { adId: 'ad-account-b', country: 'US', spend: 15 },
    ])

    expect(result.map((metric) => metric.spendUsd)).toEqual([10, 15])
  })
})
