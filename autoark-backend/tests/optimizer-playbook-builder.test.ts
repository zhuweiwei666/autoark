import { buildOptimizerPlaybookSnapshot } from '../src/services/optimizerLearning.service'

const thresholds = {
  minSpend: 10,
  minPurchases: 2,
  minActiveDays: 2,
  freshnessHours: 24,
  defaultPilotDailyBudget: 20,
  maxPilotDailyBudget: 50,
}

const performanceRows = [
  {
    kind: 'country',
    dimensionKey: 'US',
    dimension: { country: 'US' },
    date: '2026-07-25',
    adId: 'ad_1',
    spend: 10,
    impressions: 1000,
    clicks: 50,
    purchases: 2,
    purchaseValue: 60,
  },
  {
    kind: 'country',
    dimensionKey: 'US',
    dimension: { country: 'US' },
    date: '2026-07-26',
    adId: 'ad_1',
    spend: 10,
    impressions: 1000,
    clicks: 50,
    purchases: 2,
    purchaseValue: 60,
  },
  {
    kind: 'placement',
    dimensionKey: 'instagram|reels|iphone',
    dimension: {
      publisherPlatform: 'instagram',
      platformPosition: 'reels',
      impressionDevice: 'iphone',
    },
    date: '2026-07-26',
    adId: 'ad_1',
    spend: 20,
    impressions: 2000,
    clicks: 100,
    purchases: 4,
    purchaseValue: 120,
  },
  {
    kind: 'hourly',
    dimensionKey: '20:00:00 - 20:59:59',
    dimension: { hour: '20:00:00 - 20:59:59' },
    date: '2026-07-26',
    adId: 'ad_1',
    spend: 20,
    impressions: 2000,
    clicks: 100,
    purchases: 4,
    purchaseValue: 120,
  },
]

const buildInput = (overrides: any = {}) => ({
  optimizerId: 'buyer-a',
  scopeKey: 'org:665000000000000000000001',
  organizationId: '665000000000000000000001',
  window: { since: '2026-07-20', until: '2026-07-26' },
  accounts: [
    {
      accountId: '123',
      currency: 'USD',
      sourceSyncedAt: new Date(),
    },
  ],
  tokenIds: ['665000000000000000000002'],
  breakdowns: performanceRows,
  campaigns: [
    {
      campaignId: 'campaign_1',
      accountId: '123',
      name: 'Winner',
      objective: 'OUTCOME_SALES',
      daily_budget: '3000',
      raw: { daily_budget: '3000', buying_type: 'AUCTION' },
    },
  ],
  adsets: [
    {
      adsetId: 'adset_1',
      campaignId: 'campaign_1',
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      raw: {
        daily_budget: '2000',
        billing_event: 'IMPRESSIONS',
        targeting: {
          geo_locations: { countries: ['US', 'CA'] },
          publisher_platforms: ['facebook', 'instagram'],
          custom_audiences: [{ id: 'source-account-only' }],
        },
      },
    },
  ],
  ads: [
    {
      adId: 'ad_1',
      campaignId: 'campaign_1',
      adsetId: 'adset_1',
      creativeId: 'creative_1',
    },
  ],
  creatives: [
    {
      creativeId: 'creative_1',
      materialIds: ['665000000000000000000003'],
      raw: {
        object_story_spec: {
          link_data: {
            message: 'Primary',
            name: 'Headline',
            description: 'Description',
            link: 'https://example.com/product',
            call_to_action: { type: 'SHOP_NOW' },
          },
        },
      },
    },
  ],
  materials: [
    {
      _id: '665000000000000000000003',
      name: 'Winner image',
      type: 'image',
      status: 'ready',
      storage: { url: 'https://cdn.example.com/winner.jpg' },
    },
  ],
  liveCollection: {
    collectedAt: new Date(),
    truncatedAccounts: 0,
    dimensions: {
      country: { status: 'complete' },
      placement: { status: 'complete' },
      hourly: { status: 'complete' },
    },
  },
  sourceSyncedAt: new Date(),
  storedRowsTruncated: 0,
  thresholds,
  ...overrides,
})

describe('optimizer playbook builder', () => {
  it('builds an eligible playbook from explicit optimizer-to-material lineage', () => {
    const playbook = buildOptimizerPlaybookSnapshot(buildInput())

    expect(playbook.status).toBe('ready')
    expect(playbook.eligibility.eligible).toBe(true)
    expect(playbook.structure).toMatchObject({
      sourceCampaignId: 'campaign_1',
      sourceAdsetId: 'adset_1',
      budgetOptimization: true,
      observedDailyBudget: 30,
      currency: 'USD',
    })
    expect(playbook.geography[0]).toMatchObject({
      dimension: { country: 'US' },
      purchases: 4,
      roas: 6,
    })
    expect(playbook.placements[0].dimension).toMatchObject({
      publisherPlatform: 'instagram',
      platformPosition: 'reels',
    })
    expect(playbook.hours[0].dimension.hour).toContain('20:00')
    expect(playbook.creatives.materials[0]).toMatchObject({
      materialId: '665000000000000000000003',
      name: 'Winner image',
    })
    expect(playbook.copywriting).toMatchObject({
      headlines: ['Headline'],
      websiteUrl: 'https://example.com/product',
    })
    expect(playbook.targeting.value).not.toHaveProperty('custom_audiences')
    expect(playbook.targeting.removedAccountScopedKeys).toContain(
      'custom_audiences',
    )
    expect(playbook.guardrails).toMatchObject({
      campaignStatus: 'PAUSED',
      adsetStatus: 'PAUSED',
      adStatus: 'PAUSED',
      automaticActivationAllowed: false,
      automaticScalingAllowed: false,
    })
  })

  it('blocks mixed-currency evidence and treats missing dimensions as unknown warnings', () => {
    const playbook = buildOptimizerPlaybookSnapshot(
      buildInput({
        accounts: [
          { accountId: '123', currency: 'USD' },
          { accountId: '456', currency: 'EUR' },
        ],
        breakdowns: performanceRows.filter((row) => row.kind === 'country'),
        liveCollection: {
          truncatedAccounts: 0,
          dimensions: {
            country: { status: 'complete' },
            placement: { status: 'failed' },
            hourly: { status: 'failed' },
          },
        },
      }),
    )

    expect(playbook.status).toBe('blocked')
    expect(playbook.eligibility.blockers.join(' ')).toContain('多种币种')
    expect(playbook.eligibility.warnings.join(' ')).toContain(
      '版位维度暂无数据',
    )
    expect(playbook.eligibility.warnings.join(' ')).toContain(
      '小时维度暂无数据',
    )
    expect(playbook.placements).toHaveLength(0)
    expect(playbook.hours).toHaveLength(0)
  })
})
