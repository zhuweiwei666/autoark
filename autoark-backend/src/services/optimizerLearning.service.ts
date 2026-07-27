import mongoose from 'mongoose'
import Account from '../models/Account'
import Ad from '../models/Ad'
import AdPerformanceBreakdown from '../models/AdPerformanceBreakdown'
import AdSet from '../models/AdSet'
import Campaign from '../models/Campaign'
import Creative from '../models/Creative'
import FbToken from '../models/FbToken'
import Material from '../models/Material'
import OptimizerProfile from '../models/OptimizerProfile'
import PlaybookVersion from '../models/PlaybookVersion'
import { combineFilters, objectIdValue } from '../utils/accessControl'
import { normalizeForStorage } from '../utils/accountId'
import { sanitizeOptimizerTargeting } from '../utils/optimizerTargeting'
import { collectOptimizerInsights } from './facebookOptimizerInsights.service'

type BuildThresholds = {
  minSpend: number
  minPurchases: number
  minActiveDays: number
  freshnessHours: number
  defaultPilotDailyBudget: number
  maxPilotDailyBudget: number
}

type BuildPlaybookInput = {
  optimizerId: string
  scopeKey: string
  organizationId?: any
  window: { since: string; until: string }
  accounts: any[]
  tokenIds: string[]
  breakdowns: any[]
  campaigns: any[]
  adsets: any[]
  ads: any[]
  creatives: any[]
  materials: any[]
  liveCollection: any
  sourceSyncedAt?: Date
  storedRowsTruncated: number
  thresholds: BuildThresholds
}

type AggregateMetric = {
  key: string
  dimension?: any
  spend: number
  impressions: number
  clicks: number
  purchases: number
  purchaseValue: number
  dates: Set<string>
  adIds: Set<string>
}

const asNumber = (value: any, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const boundedNumber = (
  value: any,
  fallback: number,
  min: number,
  max: number,
): number => Math.min(max, Math.max(min, asNumber(value, fallback)))

const uniqueStrings = (values: any[], limit = 1000): string[] =>
  Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter(Boolean)),
  ).slice(0, limit)

const normalizeOptimizerId = (value: any): string =>
  String(value || '')
    .trim()
    .slice(0, 120)

const errorWithStatus = (message: string, statusCode = 400) => {
  const error: any = new Error(message)
  error.statusCode = statusCode
  return error
}

const toDateString = (date: Date): string => date.toISOString().slice(0, 10)

const buildDateWindow = (windowDays: number) => {
  const untilDate = new Date()
  const sinceDate = new Date(untilDate)
  sinceDate.setUTCDate(sinceDate.getUTCDate() - Math.max(0, windowDays - 1))
  return {
    since: toDateString(sinceDate),
    until: toDateString(untilDate),
  }
}

const getThresholds = (): BuildThresholds => ({
  minSpend: boundedNumber(process.env.AI_OPTIMIZER_MIN_SPEND, 50, 0, 1000000),
  minPurchases: boundedNumber(
    process.env.AI_OPTIMIZER_MIN_PURCHASES,
    3,
    0,
    100000,
  ),
  minActiveDays: boundedNumber(
    process.env.AI_OPTIMIZER_MIN_ACTIVE_DAYS,
    3,
    1,
    90,
  ),
  freshnessHours: boundedNumber(
    process.env.AI_OPTIMIZER_FRESHNESS_HOURS,
    24,
    1,
    168,
  ),
  defaultPilotDailyBudget: boundedNumber(
    process.env.AI_REPLICA_DEFAULT_DAILY_BUDGET,
    20,
    1,
    10000,
  ),
  maxPilotDailyBudget: boundedNumber(
    process.env.AI_REPLICA_MAX_DAILY_BUDGET,
    50,
    1,
    100000,
  ),
})

const aggregateRows = (
  rows: any[],
  kind: string,
  keyForRow: (row: any) => string,
): AggregateMetric[] => {
  const byKey = new Map<string, AggregateMetric>()
  for (const row of rows) {
    if (row.kind !== kind) continue
    const key = keyForRow(row)
    if (!key) continue
    const existing = byKey.get(key) || {
      key,
      dimension: row.dimension || {},
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchaseValue: 0,
      dates: new Set<string>(),
      adIds: new Set<string>(),
    }
    existing.spend += asNumber(row.spend)
    existing.impressions += asNumber(row.impressions)
    existing.clicks += asNumber(row.clicks)
    existing.purchases += asNumber(row.purchases)
    existing.purchaseValue += asNumber(row.purchaseValue)
    if (row.date) existing.dates.add(String(row.date))
    if (row.adId) existing.adIds.add(String(row.adId))
    byKey.set(key, existing)
  }
  return Array.from(byKey.values())
}

const confidenceValue = (
  metric: Pick<AggregateMetric, 'spend' | 'purchases' | 'dates'>,
  thresholds: BuildThresholds,
) => {
  const spendConfidence =
    thresholds.minSpend > 0
      ? Math.min(1, metric.spend / thresholds.minSpend)
      : 1
  const purchaseConfidence =
    thresholds.minPurchases > 0
      ? Math.min(1, metric.purchases / thresholds.minPurchases)
      : 1
  const dayConfidence = Math.min(
    1,
    metric.dates.size / thresholds.minActiveDays,
  )
  return (spendConfidence + purchaseConfidence + dayConfidence) / 3
}

const serializeRankedMetric = (
  metric: AggregateMetric,
  thresholds: BuildThresholds,
) => {
  const roas = metric.spend > 0 ? metric.purchaseValue / metric.spend : 0
  const ctr = metric.impressions > 0 ? metric.clicks / metric.impressions : 0
  const cpa = metric.purchases > 0 ? metric.spend / metric.purchases : null
  const confidence = confidenceValue(metric, thresholds)
  return {
    key: metric.key,
    dimension: metric.dimension,
    spend: metric.spend,
    impressions: metric.impressions,
    clicks: metric.clicks,
    purchases: metric.purchases,
    purchaseValue: metric.purchaseValue,
    roas,
    ctr,
    cpa,
    activeDays: metric.dates.size,
    adCount: metric.adIds.size,
    confidence,
    score: roas * confidence + Math.log1p(metric.purchases) * 0.25,
  }
}

const rankMetrics = (
  metrics: AggregateMetric[],
  thresholds: BuildThresholds,
  limit = 20,
) =>
  metrics
    .map((metric) => serializeRankedMetric(metric, thresholds))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.purchases - left.purchases ||
        right.spend - left.spend,
    )
    .slice(0, limit)

const median = (values: number[]): number => {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

const firstDefined = (...values: any[]) =>
  values.find((value) => value !== undefined && value !== null)

const sourceBudgetInMajorUnits = (value: any): number => {
  const parsed = asNumber(value)
  return parsed > 0 ? parsed / 100 : 0
}

const extractCopywriting = (creativeRows: any[]) => {
  const primaryTexts: string[] = []
  const headlines: string[] = []
  const descriptions: string[] = []
  const links: string[] = []
  const callsToAction: string[] = []
  const displayLinks: string[] = []
  const addValue = (target: string[], value: any) => {
    const normalized = String(value || '').trim()
    if (normalized && !target.includes(normalized)) target.push(normalized)
  }

  for (const creative of creativeRows) {
    const raw = creative?.raw || {}
    const spec = raw.object_story_spec || {}
    const linkData = spec.link_data || {}
    const videoData = spec.video_data || {}
    const assetFeed = raw.asset_feed_spec || {}

    addValue(primaryTexts, linkData.message)
    addValue(primaryTexts, videoData.message)
    addValue(headlines, linkData.name)
    addValue(headlines, videoData.title)
    addValue(descriptions, linkData.description)
    addValue(descriptions, videoData.link_description)
    addValue(links, linkData.link)
    addValue(links, videoData.call_to_action?.value?.link)
    addValue(callsToAction, linkData.call_to_action?.type)
    addValue(callsToAction, videoData.call_to_action?.type)
    addValue(displayLinks, linkData.caption)

    for (const entry of assetFeed.bodies || [])
      addValue(primaryTexts, entry?.text)
    for (const entry of assetFeed.titles || []) addValue(headlines, entry?.text)
    for (const entry of assetFeed.descriptions || [])
      addValue(descriptions, entry?.text)
    for (const entry of assetFeed.link_urls || [])
      addValue(links, entry?.website_url)
    for (const value of assetFeed.call_to_action_types || [])
      addValue(callsToAction, value)
  }

  return {
    primaryTexts: primaryTexts.slice(0, 5),
    headlines: headlines.slice(0, 5),
    descriptions: descriptions.slice(0, 5),
    websiteUrl: links.find((value) => /^https?:\/\//i.test(value)) || '',
    displayLink:
      displayLinks.find((value) => /^https?:\/\//i.test(value)) || '',
    callToAction: callsToAction[0] || 'SHOP_NOW',
  }
}

const sourceFreshness = (value?: Date) => {
  if (!value) return null
  return Math.max(
    0,
    (Date.now() - new Date(value).getTime()) / (60 * 60 * 1000),
  )
}

export const buildOptimizerPlaybookSnapshot = (input: BuildPlaybookInput) => {
  const {
    accounts,
    ads,
    adsets,
    campaigns,
    creatives,
    materials,
    breakdowns,
    thresholds,
  } = input
  const countryRows = breakdowns.filter((row) => row.kind === 'country')
  const baselineAggregate = aggregateRows(
    countryRows,
    'country',
    () => '__baseline__',
  )[0] || {
    key: '__baseline__',
    spend: 0,
    impressions: 0,
    clicks: 0,
    purchases: 0,
    purchaseValue: 0,
    dates: new Set<string>(),
    adIds: new Set<string>(),
  }
  const baseline = serializeRankedMetric(baselineAggregate, thresholds)

  const adMetrics = new Map(
    aggregateRows(countryRows, 'country', (row) => String(row.adId || '')).map(
      (metric) => [metric.key, metric],
    ),
  )
  const adsById = new Map(ads.map((ad) => [String(ad.adId), ad]))
  const campaignPerformance = new Map<string, AggregateMetric>()
  const adsetPerformance = new Map<string, AggregateMetric>()
  const mergeMetric = (
    target: Map<string, AggregateMetric>,
    key: string,
    metric: AggregateMetric,
  ) => {
    if (!key) return
    const existing = target.get(key) || {
      key,
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchaseValue: 0,
      dates: new Set<string>(),
      adIds: new Set<string>(),
    }
    existing.spend += metric.spend
    existing.impressions += metric.impressions
    existing.clicks += metric.clicks
    existing.purchases += metric.purchases
    existing.purchaseValue += metric.purchaseValue
    metric.dates.forEach((date) => existing.dates.add(date))
    metric.adIds.forEach((adId) => existing.adIds.add(adId))
    target.set(key, existing)
  }

  for (const [adId, metric] of adMetrics.entries()) {
    const ad = adsById.get(adId)
    if (!ad) continue
    mergeMetric(campaignPerformance, String(ad.campaignId || ''), metric)
    mergeMetric(adsetPerformance, String(ad.adsetId || ''), metric)
  }

  const campaignRanking = rankMetrics(
    Array.from(campaignPerformance.values()),
    thresholds,
    50,
  )
  const adsetRanking = rankMetrics(
    Array.from(adsetPerformance.values()),
    thresholds,
    100,
  )
  const topCampaignId =
    campaignRanking[0]?.key || String(campaigns[0]?.campaignId || '')
  const topCampaign =
    campaigns.find(
      (campaign) => String(campaign.campaignId) === topCampaignId,
    ) || campaigns[0]
  const topCampaignAdsets = adsets.filter(
    (adset) =>
      String(adset.campaignId || '') === String(topCampaign?.campaignId || ''),
  )
  const topAdsetId =
    adsetRanking.find((entry) =>
      topCampaignAdsets.some((adset) => String(adset.adsetId) === entry.key),
    )?.key || String(topCampaignAdsets[0]?.adsetId || adsets[0]?.adsetId || '')
  const topAdset =
    adsets.find((adset) => String(adset.adsetId) === topAdsetId) || adsets[0]
  const { targeting, removedKeys } = sanitizeOptimizerTargeting(
    topAdset?.raw?.targeting || {},
  )

  const creativeById = new Map(
    creatives.map((creative) => [String(creative.creativeId), creative]),
  )
  const materialById = new Map(
    materials.map((material) => [String(material._id), material]),
  )
  const materialPerformance = new Map<string, AggregateMetric>()
  for (const [adId, metric] of adMetrics.entries()) {
    const ad = adsById.get(adId)
    const creative = creativeById.get(String(ad?.creativeId || ''))
    const materialIds = uniqueStrings([
      creative?.materialId,
      ...(creative?.materialIds || []),
      ad?.materialId,
    ])
    for (const materialId of materialIds) {
      mergeMetric(materialPerformance, materialId, metric)
    }
  }
  const materialRanking = rankMetrics(
    Array.from(materialPerformance.values()),
    thresholds,
    20,
  )
  const rankedMaterials = materialRanking
    .map((ranking) => {
      const material = materialById.get(ranking.key)
      if (
        !material ||
        !material.storage?.url ||
        !['uploaded', 'ready'].includes(material.status)
      )
        return null
      return {
        materialId: ranking.key,
        name: material.name,
        type: material.type,
        url: material.storage.url,
        thumbnailUrl: material.thumbnail?.url,
        sourceCreativeId: material.source?.externalCreativeId,
        sourceAccountId: material.source?.externalAccountId,
        performance: ranking,
      }
    })
    .filter(Boolean)

  const rankedCreativeIds = uniqueStrings(
    materialRanking.flatMap((ranking) =>
      creatives
        .filter((creative) =>
          uniqueStrings([
            creative.materialId,
            ...(creative.materialIds || []),
          ]).includes(ranking.key),
        )
        .map((creative) => creative.creativeId),
    ),
  )
  const orderedCreatives = [
    ...rankedCreativeIds
      .map((creativeId) => creativeById.get(creativeId))
      .filter(Boolean),
    ...creatives,
  ].filter(
    (creative, index, list) =>
      list.findIndex(
        (candidate) =>
          String(candidate?.creativeId) === String(creative?.creativeId),
      ) === index,
  )
  const copywriting = extractCopywriting(orderedCreatives)

  const campaignBudgetValues = (topCampaign ? [topCampaign] : []).map(
    (campaign) =>
      sourceBudgetInMajorUnits(
        firstDefined(campaign.raw?.daily_budget, campaign.daily_budget),
      ),
  )
  const adsetBudgetValues = (
    topCampaignAdsets.length > 0
      ? topCampaignAdsets
      : topAdset
        ? [topAdset]
        : []
  ).map((adset) =>
    sourceBudgetInMajorUnits(
      firstDefined(
        adset.raw?.daily_budget,
        adset.raw?.lifetime_budget,
        adset.budget,
      ),
    ),
  )
  const observedCampaignBudget = median(campaignBudgetValues)
  const observedAdsetBudget = median(adsetBudgetValues)
  const budgetOptimization = observedCampaignBudget > 0
  const observedDailyBudget = budgetOptimization
    ? observedCampaignBudget
    : observedAdsetBudget
  const suggestedPilotDailyBudget = Math.min(
    thresholds.maxPilotDailyBudget,
    Math.max(1, observedDailyBudget || thresholds.defaultPilotDailyBudget),
    thresholds.defaultPilotDailyBudget,
  )

  const geography = rankMetrics(
    aggregateRows(breakdowns, 'country', (row) => row.dimensionKey),
    thresholds,
  )
  const placements = rankMetrics(
    aggregateRows(breakdowns, 'placement', (row) => row.dimensionKey),
    thresholds,
  )
  const hours = rankMetrics(
    aggregateRows(breakdowns, 'hourly', (row) => row.dimensionKey),
    thresholds,
  )

  const blockers: string[] = []
  const warnings: string[] = []
  const currencies = uniqueStrings(accounts.map((account) => account.currency))
  if (accounts.length === 0) blockers.push('没有绑定到该投手的广告账户')
  if (currencies.length > 1) {
    blockers.push(
      `来源账户包含多种币种（${currencies.join(', ')}），不能直接聚合预算与消耗`,
    )
  } else if (currencies.length === 0) {
    warnings.push('来源账户币种未知，复制时必须人工确认预算单位')
  }
  if (baseline.spend < thresholds.minSpend) {
    blockers.push(
      `样本消耗 ${baseline.spend.toFixed(2)} 低于最低阈值 ${thresholds.minSpend}`,
    )
  }
  if (baseline.purchases < thresholds.minPurchases) {
    blockers.push(
      `购买数 ${baseline.purchases} 低于最低阈值 ${thresholds.minPurchases}`,
    )
  }
  if (baseline.activeDays < thresholds.minActiveDays) {
    blockers.push(
      `有效天数 ${baseline.activeDays} 低于最低阈值 ${thresholds.minActiveDays}`,
    )
  }
  if (!targeting.geo_locations && Object.keys(targeting).length === 0) {
    blockers.push('缺少可复制的来源定向')
  }
  if (rankedMaterials.length === 0)
    blockers.push('缺少已入库且可复用的来源素材')
  if (!copywriting.websiteUrl) blockers.push('来源文案缺少可用落地页链接')
  if (placements.length === 0)
    warnings.push('版位维度暂无数据，保留来源定向中的版位设置')
  if (hours.length === 0) warnings.push('小时维度暂无数据，不自动设置分时排期')
  if (input.storedRowsTruncated > 0) {
    warnings.push(
      `分析数据超过安全上限，尚有 ${input.storedRowsTruncated} 行未纳入本版本`,
    )
  }
  if (input.liveCollection?.truncatedAccounts > 0) {
    warnings.push(
      `来源账户超过采集上限，${input.liveCollection.truncatedAccounts} 个账户未实时刷新`,
    )
  }
  const freshnessHours = sourceFreshness(input.sourceSyncedAt)
  if (freshnessHours === null) {
    warnings.push('来源结构同步时间未知')
  } else if (freshnessHours > thresholds.freshnessHours) {
    blockers.push(`来源结构已超过 ${thresholds.freshnessHours} 小时未同步`)
  }
  for (const kind of ['country', 'placement', 'hourly']) {
    const status = input.liveCollection?.dimensions?.[kind]?.status
    if (status === 'failed')
      warnings.push(`${kind} 实时采集失败，使用已存储数据并降低置信度`)
    if (status === 'partial') warnings.push(`${kind} 仅部分账户实时采集成功`)
  }

  const coverageRatio =
    ['country', 'placement', 'hourly']
      .map((kind) => input.liveCollection?.dimensions?.[kind]?.status)
      .reduce(
        (sum, status) =>
          sum + (status === 'complete' ? 1 : status === 'partial' ? 0.5 : 0),
        0,
      ) / 3
  const confidenceScore = Math.round(
    100 *
      (baseline.confidence * 0.6 +
        coverageRatio * 0.25 +
        (targeting && rankedMaterials.length > 0 && copywriting.websiteUrl
          ? 0.15
          : 0)),
  )

  return {
    status: (blockers.length === 0 ? 'ready' : 'blocked') as
      | 'ready'
      | 'blocked',
    source: {
      window: input.window,
      accountIds: uniqueStrings(
        accounts.map((account) => normalizeForStorage(account.accountId)),
      ),
      tokenIds: input.tokenIds,
      currencies,
      campaignIds: uniqueStrings(
        campaigns.map((campaign) => campaign.campaignId),
      ),
      adsetIds: uniqueStrings(adsets.map((adset) => adset.adsetId)),
      adIds: uniqueStrings(ads.map((ad) => ad.adId)),
      sourceSyncedAt: input.sourceSyncedAt,
      liveCollectedAt: input.liveCollection?.collectedAt,
      lineage:
        'optimizerId -> tokenId -> accountId -> campaign/adset/ad -> creative/material -> performance',
    },
    coverage: {
      live: input.liveCollection,
      storedBreakdownRows: breakdowns.length,
      storedRowsTruncated: input.storedRowsTruncated,
      countries: geography.length,
      placements: placements.length,
      hours: hours.length,
      materials: rankedMaterials.length,
    },
    eligibility: {
      eligible: blockers.length === 0,
      blockers,
      warnings,
      thresholds,
    },
    confidence: {
      score: confidenceScore,
      level:
        confidenceScore >= 80
          ? 'high'
          : confidenceScore >= 55
            ? 'medium'
            : 'low',
      sourceSampleConfidence: baseline.confidence,
      liveDimensionCoverage: coverageRatio,
    },
    baseline,
    structure: {
      sourceCampaignId: topCampaign?.campaignId,
      sourceCampaignName: topCampaign?.name,
      sourceAdsetId: topAdset?.adsetId,
      sourceAdsetName: topAdset?.name,
      objective:
        topCampaign?.objective ||
        topCampaign?.raw?.objective ||
        'OUTCOME_SALES',
      buyingType:
        topCampaign?.buying_type || topCampaign?.raw?.buying_type || 'AUCTION',
      budgetOptimization,
      observedDailyBudget,
      currency: currencies[0],
      adsetsPerCampaign: topCampaignAdsets.length || 1,
      adsPerAdset:
        topCampaignAdsets.length > 0
          ? Math.max(
              1,
              Math.round(
                ads.filter(
                  (ad) =>
                    String(ad.campaignId) === String(topCampaign?.campaignId),
                ).length / topCampaignAdsets.length,
              ),
            )
          : 1,
      optimizationGoal:
        topAdset?.optimizationGoal ||
        topAdset?.raw?.optimization_goal ||
        'OFFSITE_CONVERSIONS',
      billingEvent: topAdset?.raw?.billing_event || 'IMPRESSIONS',
      bidStrategy:
        topAdset?.raw?.bid_strategy ||
        topCampaign?.raw?.bid_strategy ||
        'LOWEST_COST_WITHOUT_CAP',
      attributionSpec: topAdset?.raw?.attribution_spec,
      campaignRanking: campaignRanking.slice(0, 10),
      adsetRanking: adsetRanking.slice(0, 20),
    },
    targeting: {
      value: targeting,
      sourceAdsetId: topAdset?.adsetId,
      removedAccountScopedKeys: removedKeys,
    },
    geography,
    placements,
    hours,
    creatives: {
      attributionMode: 'creative-level-shared',
      materials: rankedMaterials.slice(0, 10),
    },
    copywriting,
    guardrails: {
      approvalRequired: true,
      campaignStatus: 'PAUSED',
      adsetStatus: 'PAUSED',
      adStatus: 'PAUSED',
      suggestedPilotDailyBudget,
      maximumPilotDailyBudget: thresholds.maxPilotDailyBudget,
      automaticActivationAllowed: false,
      automaticScalingAllowed: false,
      highConversionHoursAreRecommendationOnly: true,
      stopLoss: {
        reviewAfterSpend: Math.max(
          suggestedPilotDailyBudget,
          suggestedPilotDailyBudget * 1.5,
        ),
        action: 'pause_and_review',
      },
    },
  }
}

const accountScopeFilter = (organizationId?: any) =>
  organizationId
    ? { organizationId: objectIdValue(String(organizationId)) }
    : {
        $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
      }

const scopeKeyFor = (organizationId?: any) =>
  organizationId ? `org:${String(organizationId)}` : 'platform:unassigned'

const resolveSourceAccounts = async (
  optimizerId: string,
  organizationId?: any,
) => {
  const accounts: any[] = await Account.find({
    channel: 'facebook',
    operator: optimizerId,
    ...accountScopeFilter(organizationId),
  })
    .sort({ sourceSyncedAt: -1, updatedAt: -1 })
    .lean()
  if (accounts.length === 0)
    throw errorWithStatus('未找到该投手在当前数据范围内绑定的广告账户', 404)

  const tokens: any[] = await FbToken.find({
    status: 'active',
    ...accountScopeFilter(organizationId),
  })
    .select('_id token optimizer organizationId')
    .lean()
  const tokenByValue = new Map(
    tokens.map((token) => [String(token.token), token]),
  )
  const tokenById = new Map(tokens.map((token) => [String(token._id), token]))
  const usable = accounts
    .map((account) => {
      const token =
        tokenById.get(String(account.tokenId || '')) ||
        tokenByValue.get(String(account.token || ''))
      if (!token?.token) return null
      return {
        ...account,
        token: token.token,
        tokenId: token._id,
        operator: optimizerId,
      }
    })
    .filter(Boolean)
  if (usable.length === 0) {
    throw errorWithStatus('该投手的来源账户没有可用的活跃 Facebook 授权', 409)
  }
  return usable
}

export const listBoundOptimizers = async ({
  organizationId,
}: { organizationId?: any } = {}) => {
  const query: any = {
    channel: 'facebook',
    operator: { $exists: true, $nin: ['', null] },
  }
  if (organizationId) Object.assign(query, accountScopeFilter(organizationId))
  const accounts: any[] = await Account.find(query)
    .select(
      'accountId name operator organizationId tokenId status currency sourceSyncedAt updatedAt',
    )
    .sort({ operator: 1, accountId: 1 })
    .lean()

  const grouped = new Map<string, any>()
  for (const account of accounts) {
    const orgId = account.organizationId?.toString()
    const optimizerId = normalizeOptimizerId(account.operator)
    if (!optimizerId) continue
    const scopeKey = scopeKeyFor(orgId)
    const key = `${scopeKey}:${optimizerId}`
    const existing = grouped.get(key) || {
      scopeKey,
      organizationId: orgId,
      optimizerId,
      displayName: optimizerId,
      accounts: [],
      tokenIds: new Set<string>(),
      activeAccounts: 0,
      latestSourceSyncedAt: null,
    }
    existing.accounts.push({
      accountId: account.accountId,
      name: account.name,
      status: account.status,
      currency: account.currency,
      sourceSyncedAt: account.sourceSyncedAt,
    })
    if (account.status === 'active') existing.activeAccounts += 1
    if (account.tokenId) existing.tokenIds.add(String(account.tokenId))
    const syncedAt = account.sourceSyncedAt || account.updatedAt
    if (
      syncedAt &&
      (!existing.latestSourceSyncedAt ||
        new Date(syncedAt) > new Date(existing.latestSourceSyncedAt))
    ) {
      existing.latestSourceSyncedAt = syncedAt
    }
    grouped.set(key, existing)
  }

  const profiles: any[] = await OptimizerProfile.find({
    scopeKey: {
      $in: uniqueStrings(
        Array.from(grouped.values()).map((entry) => entry.scopeKey),
      ),
    },
    optimizerId: {
      $in: uniqueStrings(
        Array.from(grouped.values()).map((entry) => entry.optimizerId),
      ),
    },
  })
    .select(
      'scopeKey optimizerId latestPlaybookId lastGeneratedAt lastEligibility versionCounter',
    )
    .lean()
  const profileByKey = new Map(
    profiles.map((profile) => [
      `${profile.scopeKey}:${profile.optimizerId}`,
      profile,
    ]),
  )

  return Array.from(grouped.entries()).map(([key, entry]) => {
    const profile = profileByKey.get(key)
    return {
      ...entry,
      tokenIds: Array.from(entry.tokenIds),
      accountCount: entry.accounts.length,
      profileId: profile?._id,
      latestPlaybookId: profile?.latestPlaybookId,
      lastGeneratedAt: profile?.lastGeneratedAt,
      lastEligibility: profile?.lastEligibility,
      versionCount: profile?.versionCounter || 0,
    }
  })
}

export const generateOptimizerPlaybook = async ({
  optimizerId: optimizerIdInput,
  organizationId,
  windowDays: windowDaysInput = 14,
  refreshInsights = true,
  generatedBy,
}: {
  optimizerId: string
  organizationId?: any
  windowDays?: number
  refreshInsights?: boolean
  generatedBy?: string
}) => {
  const optimizerId = normalizeOptimizerId(optimizerIdInput)
  if (!optimizerId) throw errorWithStatus('optimizerId 不能为空')
  const windowDays = Math.round(boundedNumber(windowDaysInput, 14, 3, 30))
  const window = buildDateWindow(windowDays)
  const accounts = await resolveSourceAccounts(optimizerId, organizationId)
  const accountIds = uniqueStrings(
    accounts.map((account) => normalizeForStorage(account.accountId)),
  )
  const tokenIds = uniqueStrings(accounts.map((account) => account.tokenId))
  const scopeKey = scopeKeyFor(organizationId)

  const liveCollection = refreshInsights
    ? await collectOptimizerInsights({ accounts, window })
    : {
        collectedAt: null,
        totalAccounts: accounts.length,
        attemptedAccounts: 0,
        truncatedAccounts: 0,
        dimensions: {
          country: {
            status: 'not_requested',
            rows: 0,
            accountsAttempted: 0,
            accountsSucceeded: 0,
            errors: [],
          },
          placement: {
            status: 'not_requested',
            rows: 0,
            accountsAttempted: 0,
            accountsSucceeded: 0,
            errors: [],
          },
          hourly: {
            status: 'not_requested',
            rows: 0,
            accountsAttempted: 0,
            accountsSucceeded: 0,
            errors: [],
          },
        },
        accounts: [],
      }

  const maxRows = Math.min(
    250000,
    Math.max(
      1000,
      Number(process.env.AI_OPTIMIZER_MAX_ANALYSIS_ROWS || 100000),
    ),
  )
  const breakdownQuery = {
    accountId: { $in: accountIds },
    date: { $gte: window.since, $lte: window.until },
  }
  const totalBreakdownRows =
    await AdPerformanceBreakdown.countDocuments(breakdownQuery)
  const breakdowns: any[] = await AdPerformanceBreakdown.find(breakdownQuery)
    .sort({ date: 1, adId: 1 })
    .limit(maxRows)
    .lean()

  const campaigns: any[] = await Campaign.find({
    channel: 'facebook',
    accountId: { $in: accountIds },
  }).lean()
  const adsets: any[] = await AdSet.find({
    channel: 'facebook',
    accountId: { $in: accountIds },
  }).lean()
  const ads: any[] = await Ad.find({
    channel: 'facebook',
    accountId: { $in: accountIds },
  }).lean()
  const creativeIds = uniqueStrings(ads.map((ad) => ad.creativeId))
  const creatives: any[] =
    creativeIds.length > 0
      ? await Creative.find({ creativeId: { $in: creativeIds } }).lean()
      : []
  const materialIds = uniqueStrings(
    creatives.flatMap((creative) => [
      creative.materialId,
      ...(creative.materialIds || []),
    ]),
  )
  const materials: any[] =
    materialIds.length > 0
      ? await Material.find({
          _id: { $in: materialIds.filter(mongoose.Types.ObjectId.isValid) },
        }).lean()
      : []
  const sourceSyncValues = accounts.map(
    (account) => account.sourceSyncedAt || account.updatedAt,
  )
  const sourceSyncedAt = sourceSyncValues.some((value) => !value)
    ? undefined
    : sourceSyncValues.sort(
        (left, right) => new Date(left).getTime() - new Date(right).getTime(),
      )[0]

  const snapshot = buildOptimizerPlaybookSnapshot({
    optimizerId,
    scopeKey,
    organizationId,
    window,
    accounts,
    tokenIds,
    breakdowns,
    campaigns,
    adsets,
    ads,
    creatives,
    materials,
    liveCollection,
    sourceSyncedAt,
    storedRowsTruncated: Math.max(totalBreakdownRows - breakdowns.length, 0),
    thresholds: getThresholds(),
  })

  const profile: any = await OptimizerProfile.findOneAndUpdate(
    { scopeKey, optimizerId },
    {
      $setOnInsert: {
        scopeKey,
        optimizerId,
        displayName: optimizerId,
        ...(organizationId && {
          organizationId: objectIdValue(String(organizationId)),
        }),
      },
      $set: {
        tokenIds: tokenIds.filter(mongoose.Types.ObjectId.isValid),
        accountIds,
        lastGeneratedAt: new Date(),
        lastSourceSyncedAt: sourceSyncedAt,
        lastEligibility: snapshot.eligibility,
      },
      $inc: { versionCounter: 1 },
    },
    { upsert: true, new: true },
  )
  const version = profile.versionCounter
  const playbook: any = await PlaybookVersion.create({
    profileId: profile._id,
    scopeKey,
    organizationId: organizationId
      ? objectIdValue(String(organizationId))
      : undefined,
    optimizerId,
    version,
    generatedBy,
    ...snapshot,
  })
  profile.latestPlaybookId = playbook._id
  await profile.save()
  return playbook.toObject()
}

export const listPlaybooks = async ({
  optimizerId,
  organizationId,
  allOrganizations = false,
  limit = 20,
}: {
  optimizerId?: string
  organizationId?: any
  allOrganizations?: boolean
  limit?: number
} = {}) => {
  const query: any = {}
  if (optimizerId) query.optimizerId = normalizeOptimizerId(optimizerId)
  if (organizationId)
    query.organizationId = objectIdValue(String(organizationId))
  else if (!allOrganizations)
    query.$or = [
      { organizationId: { $exists: false } },
      { organizationId: null },
    ]
  return PlaybookVersion.find(query)
    .sort({ generatedAt: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 20)))
    .lean()
}

export const getPlaybook = async (id: string, accessFilter: any = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id))
    throw errorWithStatus('打法版本 ID 无效')
  const playbook = await PlaybookVersion.findOne(
    combineFilters({ _id: id }, accessFilter),
  ).lean()
  if (!playbook) throw errorWithStatus('打法版本不存在或无权访问', 404)
  return playbook
}
