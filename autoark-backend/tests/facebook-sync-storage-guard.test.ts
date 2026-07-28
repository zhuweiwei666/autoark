const originalNodeEnv = process.env.NODE_ENV
const originalSyncEnabled = process.env.FACEBOOK_SYNC_ENABLED
const originalAggregationEnabled = process.env.FACEBOOK_AGGREGATION_ENABLED
const originalAggregationConcurrency =
  process.env.FACEBOOK_AGGREGATION_CONCURRENCY
const originalBatchLimit = process.env.FACEBOOK_SYNC_ACCOUNT_BATCH_LIMIT
const originalAdConcurrency = process.env.FACEBOOK_AD_SYNC_CONCURRENCY

import {
  FACEBOOK_INSIGHTS_DATE_PRESETS,
  getFacebookAggregationConcurrency,
  getFacebookSyncAccountBatchLimit,
  getFacebookWorkerConcurrency,
  isFacebookAggregationEnabled,
  isFacebookSyncEnabled,
} from '../src/config/facebookSync'

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('facebook sync storage guard configuration', () => {
  afterEach(() => {
    restoreEnv('NODE_ENV', originalNodeEnv)
    restoreEnv('FACEBOOK_SYNC_ENABLED', originalSyncEnabled)
    restoreEnv('FACEBOOK_AGGREGATION_ENABLED', originalAggregationEnabled)
    restoreEnv(
      'FACEBOOK_AGGREGATION_CONCURRENCY',
      originalAggregationConcurrency,
    )
    restoreEnv('FACEBOOK_SYNC_ACCOUNT_BATCH_LIMIT', originalBatchLimit)
    restoreEnv('FACEBOOK_AD_SYNC_CONCURRENCY', originalAdConcurrency)
  })

  it('fails closed in production unless Facebook sync is explicitly enabled', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.FACEBOOK_SYNC_ENABLED

    expect(isFacebookSyncEnabled()).toBe(false)

    process.env.FACEBOOK_SYNC_ENABLED = 'true'
    expect(isFacebookSyncEnabled()).toBe(true)
  })

  it('allows bounded aggregation to be enabled without resuming Facebook queues', () => {
    process.env.NODE_ENV = 'production'
    process.env.FACEBOOK_SYNC_ENABLED = 'false'
    process.env.FACEBOOK_AGGREGATION_ENABLED = 'true'

    expect(isFacebookSyncEnabled()).toBe(false)
    expect(isFacebookAggregationEnabled()).toBe(true)

    process.env.FACEBOOK_AGGREGATION_ENABLED = 'false'
    expect(isFacebookAggregationEnabled()).toBe(false)
  })

  it('keeps aggregation fail-closed when its dedicated flag is absent', () => {
    process.env.NODE_ENV = 'production'
    process.env.FACEBOOK_SYNC_ENABLED = 'false'
    delete process.env.FACEBOOK_AGGREGATION_ENABLED

    expect(isFacebookAggregationEnabled()).toBe(false)
  })

  it('keeps non-production environments enabled by default', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.FACEBOOK_SYNC_ENABLED
    delete process.env.FACEBOOK_AGGREGATION_ENABLED

    expect(isFacebookSyncEnabled()).toBe(true)
    expect(isFacebookAggregationEnabled()).toBe(true)
  })

  it('caps scheduled account batches and worker concurrency', () => {
    process.env.FACEBOOK_SYNC_ACCOUNT_BATCH_LIMIT = '5000'
    process.env.FACEBOOK_AD_SYNC_CONCURRENCY = '99'
    process.env.FACEBOOK_AGGREGATION_CONCURRENCY = '99'

    expect(getFacebookSyncAccountBatchLimit()).toBe(100)
    expect(getFacebookWorkerConcurrency('ad')).toBe(10)
    expect(getFacebookAggregationConcurrency()).toBe(5)

    delete process.env.FACEBOOK_AGGREGATION_CONCURRENCY
    expect(getFacebookAggregationConcurrency()).toBe(2)
  })

  it('does not request the redundant last_3d insights window', () => {
    expect(FACEBOOK_INSIGHTS_DATE_PRESETS).toEqual([
      'today',
      'yesterday',
      'last_7d',
    ])
    expect(FACEBOOK_INSIGHTS_DATE_PRESETS).not.toContain('last_3d')
  })
})
