/**
 * 📊 预聚合数据服务
 * 
 * 核心逻辑：
 * - 最近 3 天：从 Facebook API 实时获取 → 更新到数据库
 * - 超过 3 天：直接从数据库读取
 * 
 * 性能优化：
 * - 并发处理：使用 Promise.all + 分批控制（并发度 10）
 * - 错误隔离：单个账户失败不影响整体
 */

import logger from '../utils/logger'
import { 
  AggDaily, 
  AggCountry, 
  AggCountryAccount,
  AggAccount, 
  AggCampaign, 
  AggOptimizer, 
  isRecentDate 
} from '../models/Aggregation'
import Account from '../models/Account'
import Campaign from '../models/Campaign'
import { fetchInsights } from '../integration/facebook/insights.api'
import { resolveAccountOperationalAuthorizations } from './metaBusinessCredential.service'
import { getFacebookAggregationConcurrency } from '../config/facebookSync'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import { getMutableInsightsDates } from '../utils/shanghaiDate'
import {
  beginMetaInsightsCoverageAttempts,
  buildMetaInsightsFactSnapshot,
  getCoverageSnapshotAccountIds,
  getDeferredInsightsAccountIds,
  MetaInsightsCoverageOutcome,
  MetaInsightsFactSnapshot,
  persistMetaInsightsCoverageOutcomes,
  persistMetaInsightsFactSnapshots,
} from './metaInsightsPersistence.service'

const INSIGHTS_FINALIZATION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

// 国家代码到名称的映射
const COUNTRY_NAMES: Record<string, string> = {
  'US': '美国', 'GB': '英国', 'CA': '加拿大', 'AU': '澳大利亚',
  'JP': '日本', 'KR': '韩国', 'TW': '台湾', 'HK': '香港',
  'TH': '泰国', 'VN': '越南', 'ID': '印尼', 'MY': '马来西亚', 'SG': '新加坡', 'PH': '菲律宾',
  'IN': '印度', 'PK': '巴基斯坦', 'BD': '孟加拉',
  'BR': '巴西', 'MX': '墨西哥', 'AR': '阿根廷',
  'DE': '德国', 'FR': '法国', 'IT': '意大利', 'ES': '西班牙', 'NL': '荷兰',
  'RU': '俄罗斯', 'TR': '土耳其', 'SA': '沙特', 'AE': '阿联酋', 'EG': '埃及',
}

export interface AggregationRefreshOptions {
  accountIds?: string[]
  ignoreRetryBackoff?: boolean
}

export interface AggregationRefreshResult {
  processedAccountIds: string[]
  cachedAccountIds: string[]
  unavailableAccountIds: string[]
  deferredAccountIds: string[]
  skipped?: boolean
}

const emptyRefreshResult = (skipped = false): AggregationRefreshResult => ({
  processedAccountIds: [],
  cachedAccountIds: [],
  unavailableAccountIds: [],
  deferredAccountIds: [],
  ...(skipped ? { skipped: true } : {}),
})

const rebuildDerivedAggregationFromSnapshots = async (date: string) => {
  const [dailyRows, countryRows, optimizerRows, activeCampaigns, existingDaily] = await Promise.all([
    AggAccount.aggregate([
      { $match: { date } },
      {
        $group: {
          _id: null,
          spend: { $sum: '$spend' },
          revenue: { $sum: '$revenue' },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: '$installs' },
          activeAccounts: {
            $sum: { $cond: [{ $gt: ['$spend', 0] }, 1, 0] },
          },
        },
      },
    ]),
    AggCountryAccount.aggregate([
      { $match: { date } },
      {
        $group: {
          _id: '$country',
          countryName: { $first: '$countryName' },
          spend: { $sum: '$spend' },
          revenue: { $sum: '$revenue' },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: '$installs' },
          campaigns: { $sum: '$campaigns' },
        },
      },
    ]),
    AggCampaign.aggregate([
      { $match: { date } },
      {
        $group: {
          _id: '$optimizer',
          spend: { $sum: '$spend' },
          revenue: { $sum: '$revenue' },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: '$installs' },
          campaigns: { $sum: { $cond: [{ $gt: ['$spend', 0] }, 1, 0] } },
          accounts: { $addToSet: '$accountId' },
        },
      },
    ]),
    AggCampaign.countDocuments({ date, spend: { $gt: 0 } }),
    AggDaily.findOne({ date }).lean(),
  ])

  const daily = dailyRows[0] || {
    spend: 0,
    revenue: 0,
    impressions: 0,
    clicks: 0,
    installs: 0,
    activeAccounts: 0,
  }
  const spend = Number(daily.spend || 0)
  const revenue = Number(daily.revenue || 0)
  const impressions = Number(daily.impressions || 0)
  const clicks = Number(daily.clicks || 0)
  const installs = Number(daily.installs || 0)

  await AggDaily.findOneAndUpdate(
    { date },
    {
      date,
      spend: Math.round(spend * 100) / 100,
      revenue: Math.round(revenue * 100) / 100,
      roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
      impressions,
      clicks,
      installs,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
      cpm: impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : 0,
      cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
      cpi: installs > 0 ? Math.round((spend / installs) * 100) / 100 : 0,
      activeCampaigns,
      activeAccounts: Number(daily.activeAccounts || 0),
      // A targeted repair cannot prove that every account for a previously
      // unseen date was covered, so a new rollup must start as partial.
      dataStatus: existingDaily?.dataStatus || 'partial',
      failedAccounts: Number(existingDaily?.failedAccounts || 0),
      cachedAccounts: Number(existingDaily?.cachedAccounts || 0),
    },
    { upsert: true },
  )

  const countryKeys = countryRows.map((row: any) => row._id)
  await AggCountry.bulkWrite([
    ...countryRows.map((row: any) => {
      const countrySpend = Number(row.spend || 0)
      const countryRevenue = Number(row.revenue || 0)
      const countryImpressions = Number(row.impressions || 0)
      const countryClicks = Number(row.clicks || 0)
      return {
        updateOne: {
          filter: { date, country: row._id },
          update: {
            date,
            country: row._id,
            countryName: row.countryName || COUNTRY_NAMES[row._id] || row._id,
            spend: Math.round(countrySpend * 100) / 100,
            revenue: Math.round(countryRevenue * 100) / 100,
            roas: countrySpend > 0
              ? Math.round((countryRevenue / countrySpend) * 100) / 100
              : 0,
            impressions: countryImpressions,
            clicks: countryClicks,
            installs: Number(row.installs || 0),
            ctr: countryImpressions > 0
              ? Math.round((countryClicks / countryImpressions) * 10000) / 100
              : 0,
            campaigns: Number(row.campaigns || 0),
          },
          upsert: true,
        },
      }
    }),
    {
      deleteMany: {
        filter: {
          date,
          ...(countryKeys.length > 0 ? { country: { $nin: countryKeys } } : {}),
        },
      },
    },
  ])

  const optimizerKeys = optimizerRows.map((row: any) => row._id || 'unknown')
  await AggOptimizer.bulkWrite([
    ...optimizerRows.map((row: any) => {
      const optimizerSpend = Number(row.spend || 0)
      const optimizerRevenue = Number(row.revenue || 0)
      const optimizerImpressions = Number(row.impressions || 0)
      const optimizerClicks = Number(row.clicks || 0)
      return {
        updateOne: {
          filter: { date, optimizer: row._id || 'unknown' },
          update: {
            date,
            optimizer: row._id || 'unknown',
            spend: Math.round(optimizerSpend * 100) / 100,
            revenue: Math.round(optimizerRevenue * 100) / 100,
            roas: optimizerSpend > 0
              ? Math.round((optimizerRevenue / optimizerSpend) * 100) / 100
              : 0,
            impressions: optimizerImpressions,
            clicks: optimizerClicks,
            installs: Number(row.installs || 0),
            ctr: optimizerImpressions > 0
              ? Math.round((optimizerClicks / optimizerImpressions) * 10000) / 100
              : 0,
            campaigns: Number(row.campaigns || 0),
            accounts: Array.isArray(row.accounts) ? row.accounts.length : 0,
          },
          upsert: true,
        },
      }
    }),
    {
      deleteMany: {
        filter: {
          date,
          ...(optimizerKeys.length > 0 ? { optimizer: { $nin: optimizerKeys } } : {}),
        },
      },
    },
  ])
}

/**
 * 🔄 刷新指定日期的所有聚合数据
 * @param date YYYY-MM-DD 格式
 * @param forceRefresh 是否强制刷新（即使不在最近3天内）
 */
async function refreshAggregationNow(
  date: string,
  forceRefresh = false,
  options: AggregationRefreshOptions = {},
): Promise<AggregationRefreshResult> {
  const requestedAccountIds = Array.from(new Set(
    (options.accountIds || []).map(normalizeForStorage).filter(Boolean),
  ))
  const isTargetedRefresh = requestedAccountIds.length > 0

  // 如果不是最近3天且不强制刷新，跳过
  if (!isRecentDate(date) && !forceRefresh) {
    logger.info(`[Aggregation] Skipping ${date} - not in recent 3 days`)
    return emptyRefreshResult(true)
  }

  logger.info(`[Aggregation] Refreshing aggregation for ${date}...`)
  const startTime = Date.now()
  const attemptedAt = new Date()

  try {
    // 已经写入当天聚合的账户也必须继续参与当天重算，否则账户封禁后
    // 下一轮全量覆盖会把它此前已计入的花费从日汇总中抹掉。
    const previouslyAggregatedAccountIds = isTargetedRefresh
      ? []
      : await AggAccount.distinct('accountId', { date })
    const accountEligibility: Array<Record<string, unknown>> = [
      { status: 'active' },
      { insightsFinalizationUntil: { $gte: new Date() } },
      {
        status: { $in: ['disabled', 'unsettled', 'review', 'closed'] },
        insightsFinalizationUntil: { $exists: false },
        sourceSyncedAt: {
          $gte: new Date(Date.now() - INSIGHTS_FINALIZATION_WINDOW_MS),
        },
      },
    ]
    if (previouslyAggregatedAccountIds.length > 0) {
      accountEligibility.push({
        accountId: { $in: previouslyAggregatedAccountIds },
      })
    }

    // 活跃账户持续刷新；刚转为非活跃的账户在有限窗口内继续刷新，
    // 当天已有聚合行的账户则在该日期停止滚动刷新前保持可重算。
    const accounts = await Account.find(isTargetedRefresh
      ? {
          channel: 'facebook',
          accountId: { $in: getAccountIdsForQuery(requestedAccountIds) },
        }
      : {
          channel: 'facebook',
          $or: accountEligibility,
        }).lean()
    logger.info(
      `[Aggregation] Found ${accounts.length} insights-eligible accounts ` +
        `(${previouslyAggregatedAccountIds.length} already aggregated for ${date})`,
    )

    const returnedAccountIds = new Set(
      accounts.map((account: any) => normalizeForStorage(account.accountId)),
    )
    const missingPreviouslyAggregatedAccountIds = Array.from(new Set(
      previouslyAggregatedAccountIds
        .map(normalizeForStorage)
        .filter((accountId) => !returnedAccountIds.has(accountId)),
    ))
    const missingCatalogAccountIds = missingPreviouslyAggregatedAccountIds.length > 0
      ? missingPreviouslyAggregatedAccountIds
      : accounts.length === 0
        ? requestedAccountIds
        : []

    // An empty or partial account catalog can be a transient sync/database
    // problem. Never reinterpret it as a verified zero and overwrite the day.
    if (accounts.length === 0 || missingPreviouslyAggregatedAccountIds.length > 0) {
      const snapshotAccountIds = await getCoverageSnapshotAccountIds(
        date,
        missingCatalogAccountIds,
      )
      if (missingCatalogAccountIds.length > 0) {
        await beginMetaInsightsCoverageAttempts(
          date,
          missingCatalogAccountIds,
          attemptedAt,
        )
        const catalogError = new Error(
          'Account catalog incomplete during aggregation refresh',
        )
        await persistMetaInsightsCoverageOutcomes(
          missingCatalogAccountIds.map((accountId) => ({
            date,
            accountId,
            status: snapshotAccountIds.has(accountId) ? 'stale' : 'unavailable',
            hasSnapshot: snapshotAccountIds.has(accountId),
            error: catalogError,
          })),
          attemptedAt,
        )
      }
      logger.warn(
        `[Aggregation] Account catalog incomplete for ${date}; ` +
          'preserving existing facts and aggregates',
      )
      return {
        ...emptyRefreshResult(true),
        cachedAccountIds: [...snapshotAccountIds],
        unavailableAccountIds: missingCatalogAccountIds.filter(
          (accountId) => !snapshotAccountIds.has(accountId),
        ),
      }
    }

    const deferredByBackoff = options.ignoreRetryBackoff
      ? new Set<string>()
      : await getDeferredInsightsAccountIds(
          date,
          accounts.map((account: any) => normalizeForStorage(account.accountId)),
          attemptedAt,
        )

    const accountsWithPersistentSnapshots = await getCoverageSnapshotAccountIds(
      date,
      accounts.map((account: any) => normalizeForStorage(account.accountId)),
    )
    await beginMetaInsightsCoverageAttempts(
      date,
      accounts.map((account: any) => normalizeForStorage(account.accountId))
        .filter((accountId) => !deferredByBackoff.has(accountId)),
      attemptedAt,
    )

    // 预先查询所有 Campaign 名称（Facebook API 可能不返回名称）
    const allCampaigns = await Campaign.find({}).select('campaignId name').lean()
    const campaignNameMap = new Map<string, string>()
    for (const c of allCampaigns) {
      campaignNameMap.set(c.campaignId, c.name || '')
    }
    logger.info(`[Aggregation] Loaded ${campaignNameMap.size} campaign names`)

    // 收集所有数据（线程安全，无需锁，因为 JS 是单线程的）
    const dailyData = { spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0 }
    const countryMap = new Map<string, any>()
    const accountCountryOps: any[] = []
    const accountMap = new Map<string, any>()
    const campaignMap = new Map<string, any>()
    const optimizerMap = new Map<string, any>()
    const factSnapshots: MetaInsightsFactSnapshot[] = []
    const coverageOutcomes: MetaInsightsCoverageOutcome[] = []

    // === 并发处理逻辑 ===
    const concurrencyLimit = getFacebookAggregationConcurrency()
    const chunks = []
    for (let i = 0; i < accounts.length; i += concurrencyLimit) {
      chunks.push(accounts.slice(i, i + concurrencyLimit))
    }

    let processedCount = 0
    let errorCount = 0
    let cachedFallbackCount = 0
    let cachedActiveAccountCount = 0
    let unavailableCount = 0
    const successfulAccountIds = new Set<string>()
    const cachedAccountIds = new Set<string>()
    const unavailableAccountIds = new Set<string>()
    const deferredAccountIds = new Set<string>()
    const staleAccountIds = new Set<string>()

    const restoreCachedContribution = async (account: any) => {
      const [cachedAccount, cachedCountries, cachedCampaigns] = await Promise.all([
        AggAccount.findOne({ date, accountId: account.accountId }).lean(),
        AggCountryAccount.find({ date, accountId: account.accountId }).lean(),
        AggCampaign.find({ date, accountId: account.accountId }).lean(),
      ])
      if (!cachedAccount) return false

      dailyData.spend += Number(cachedAccount.spend || 0)
      dailyData.revenue += Number(cachedAccount.revenue || 0)
      dailyData.impressions += Number(cachedAccount.impressions || 0)
      dailyData.clicks += Number(cachedAccount.clicks || 0)
      dailyData.installs += Number(cachedAccount.installs || 0)
      if (Number(cachedAccount.spend || 0) > 0) {
        cachedActiveAccountCount++
      }

      for (const cachedCountry of cachedCountries) {
        const countryKey = cachedCountry.country
        if (!countryMap.has(countryKey)) {
          countryMap.set(countryKey, {
            country: countryKey,
            countryName: cachedCountry.countryName || COUNTRY_NAMES[countryKey] || countryKey,
            spend: 0,
            revenue: 0,
            impressions: 0,
            clicks: 0,
            installs: 0,
            campaigns: new Set(),
          })
        }
        const country = countryMap.get(countryKey)
        country.spend += Number(cachedCountry.spend || 0)
        country.revenue += Number(cachedCountry.revenue || 0)
        country.impressions += Number(cachedCountry.impressions || 0)
        country.clicks += Number(cachedCountry.clicks || 0)
        country.installs += Number(cachedCountry.installs || 0)
      }

      for (const cachedCampaign of cachedCampaigns) {
        campaignMap.set(cachedCampaign.campaignId, {
          campaignId: cachedCampaign.campaignId,
          campaignName: cachedCampaign.campaignName || '',
          accountId: cachedCampaign.accountId,
          accountName: cachedCampaign.accountName || account.name || '',
          optimizer: cachedCampaign.optimizer || 'unknown',
          spend: Number(cachedCampaign.spend || 0),
          revenue: Number(cachedCampaign.revenue || 0),
          impressions: Number(cachedCampaign.impressions || 0),
          clicks: Number(cachedCampaign.clicks || 0),
          installs: Number(cachedCampaign.installs || 0),
          status: cachedCampaign.status || 'ACTIVE',
          objective: cachedCampaign.objective || '',
        })
      }

      return true
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (account) => {
        const normalizedAccountId = normalizeForStorage(account.accountId)
        if (deferredByBackoff.has(normalizedAccountId)) {
          const restored = await restoreCachedContribution(account)
          errorCount++
          deferredAccountIds.add(normalizedAccountId)
          if (restored) {
            cachedFallbackCount++
            cachedAccountIds.add(normalizedAccountId)
            staleAccountIds.add(normalizedAccountId)
          } else {
            unavailableCount++
            unavailableAccountIds.add(normalizedAccountId)
          }
          return
        }

        try {
          const authorizations = await resolveAccountOperationalAuthorizations({
            accountId: account.accountId,
            organizationId: (account as any).organizationId,
            legacyToken: (account as any).token,
            legacyTokenId: (account as any).tokenId,
          })
          if (authorizations.length === 0) {
            throw new Error('No operational authorization')
          }
          
          // 获取 campaign 级别数据（含国家维度）
          let insights: any[] | undefined
          let lastAuthorizationError: unknown
          let selectedAuthorization: any
          for (const authorization of authorizations) {
            try {
              insights = await fetchInsights(
                `act_${account.accountId}`,
                'campaign',
                undefined,
                authorization.token,
                ['country'],
                { since: date, until: date }
              )
              selectedAuthorization = authorization
              break
            } catch (error) {
              lastAuthorizationError = error
            }
          }
          if (!insights) {
            throw lastAuthorizationError || new Error('Insights request failed')
          }

          let accountSpend = 0
          let accountRevenue = 0
          let accountImpressions = 0
          let accountClicks = 0
          let accountInstalls = 0
          const accountCampaigns = new Set<string>()
          const accountCountryMap = new Map<string, any>()

          for (const insight of insights) {
            const spend = parseFloat(insight.spend || '0')
            const impressions = parseInt(insight.impressions || '0', 10)
            const clicks = parseInt(insight.clicks || '0', 10)
            let revenue = 0
            let installs = 0

            // 提取 purchase value
            if (insight.action_values && Array.isArray(insight.action_values)) {
              const purchaseAction = insight.action_values.find((a: any) => 
                a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase' || a.action_type === 'omni_purchase'
              )
              if (purchaseAction) {
                revenue = parseFloat(purchaseAction.value) || 0
              }
            }

            // 提取 installs
            if (insight.actions) {
              for (const action of insight.actions) {
                if (action.action_type === 'mobile_app_install') {
                  installs += parseInt(action.value || '0', 10)
                }
              }
            }

            // 累加到日汇总
            dailyData.spend += spend
            dailyData.revenue += revenue
            dailyData.impressions += impressions
            dailyData.clicks += clicks
            dailyData.installs += installs

            // 累加到账户
            accountSpend += spend
            accountRevenue += revenue
            accountImpressions += impressions
            accountClicks += clicks
            accountInstalls += installs

            // 记录 Campaign
            if (insight.campaign_id) {
              accountCampaigns.add(insight.campaign_id)
              
              const campaignKey = insight.campaign_id
              if (!campaignMap.has(campaignKey)) {
                // 优先使用预加载的名称，其次用 API 返回的
                const campaignName = campaignNameMap.get(insight.campaign_id) || insight.campaign_name || ''
                // 从名称提取投手
                const optimizer = campaignName.split('_')[0] || 'unknown'
                
                campaignMap.set(campaignKey, {
                  campaignId: insight.campaign_id,
                  campaignName,
                  accountId: account.accountId,
                  accountName: account.name || '',
                  optimizer,
                  spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
                  status: insight.campaign_status || 'ACTIVE',
                  objective: insight.objective || '',
                })
              }
              const c = campaignMap.get(campaignKey)
              c.spend += spend
              c.revenue += revenue
              c.impressions += impressions
              c.clicks += clicks
              c.installs += installs
            }

            // 记录国家
            if (insight.country) {
              const countryKey = insight.country
              if (!countryMap.has(countryKey)) {
                countryMap.set(countryKey, {
                  country: countryKey,
                  countryName: COUNTRY_NAMES[countryKey] || countryKey,
                  spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
                  campaigns: new Set(),
                })
              }
              const cn = countryMap.get(countryKey)
              cn.spend += spend
              cn.revenue += revenue
              cn.impressions += impressions
              cn.clicks += clicks
              cn.installs += installs
              if (insight.campaign_id) cn.campaigns.add(insight.campaign_id)

              if (!accountCountryMap.has(countryKey)) {
                accountCountryMap.set(countryKey, {
                  country: countryKey,
                  countryName: COUNTRY_NAMES[countryKey] || countryKey,
                  spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
                  campaigns: new Set(),
                })
              }
              const accountCountry = accountCountryMap.get(countryKey)
              accountCountry.spend += spend
              accountCountry.revenue += revenue
              accountCountry.impressions += impressions
              accountCountry.clicks += clicks
              accountCountry.installs += installs
              if (insight.campaign_id) accountCountry.campaigns.add(insight.campaign_id)
            }
          }

          const currentCountries = Array.from(accountCountryMap.keys())
          for (const country of accountCountryMap.values()) {
            accountCountryOps.push({
              updateOne: {
                filter: {
                  date,
                  accountId: account.accountId,
                  country: country.country,
                },
                update: {
                  date,
                  accountId: account.accountId,
                  country: country.country,
                  countryName: country.countryName,
                  spend: Math.round(country.spend * 100) / 100,
                  revenue: Math.round(country.revenue * 100) / 100,
                  roas: country.spend > 0
                    ? Math.round((country.revenue / country.spend) * 100) / 100
                    : 0,
                  impressions: country.impressions,
                  clicks: country.clicks,
                  installs: country.installs,
                  ctr: country.impressions > 0
                    ? Math.round((country.clicks / country.impressions) * 10000) / 100
                    : 0,
                  campaigns: country.campaigns.size,
                },
                upsert: true,
              },
            })
          }
          accountCountryOps.push({
            deleteMany: {
              filter: {
                date,
                accountId: account.accountId,
                ...(currentCountries.length > 0
                  ? { country: { $nin: currentCountries } }
                  : {}),
              },
            },
          })

          // 保存账户数据
          accountMap.set(account.accountId, {
            accountId: account.accountId,
            accountName: account.name || '',
            spend: accountSpend,
            revenue: accountRevenue,
            impressions: accountImpressions,
            clicks: accountClicks,
            installs: accountInstalls,
            campaigns: accountCampaigns.size,
            status: account.status || 'active',
          })
          const factSnapshot = buildMetaInsightsFactSnapshot({
            date,
            accountId: account.accountId,
            accountName: account.name || '',
            insights,
            campaignNameMap,
            authorization: selectedAuthorization,
            fetchedAt: attemptedAt,
          })
          factSnapshots.push(factSnapshot)
          coverageOutcomes.push({
            date,
            accountId: normalizedAccountId,
            status: 'fresh',
            hasSnapshot: true,
            factRows: factSnapshot.rows.length,
            authorizationType: selectedAuthorization?.authorizationType,
            authorizationId: selectedAuthorization?.metaCredentialId
              || selectedAuthorization?.legacyTokenId,
          })
          successfulAccountIds.add(normalizedAccountId)
          
          processedCount++

        } catch (error: any) {
          errorCount++
          const restored = await restoreCachedContribution(account)
          if (restored) {
            cachedFallbackCount++
            cachedAccountIds.add(normalizedAccountId)
            staleAccountIds.add(normalizedAccountId)
          } else {
            unavailableCount++
            unavailableAccountIds.add(normalizedAccountId)
          }
          const hasPersistentSnapshot = restored
            || accountsWithPersistentSnapshots.has(normalizedAccountId)
          coverageOutcomes.push({
            date,
            accountId: normalizedAccountId,
            status: hasPersistentSnapshot ? 'stale' : 'unavailable',
            hasSnapshot: hasPersistentSnapshot,
            error,
          })
          logger.warn(
            `[Aggregation] Failed to fetch account ${account.accountId}; `
            + `${restored ? 'kept cached snapshot' : 'no cached snapshot available'}: `
            + String(error?.message || error).slice(0, 300),
          )
        }
      }))
    }

    // 聚合投手数据（从 Campaign 汇总）
    for (const [, campaign] of campaignMap) {
      const optimizer = campaign.optimizer
      if (!optimizerMap.has(optimizer)) {
        optimizerMap.set(optimizer, {
          optimizer,
          spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0,
          campaigns: new Set(),
          accounts: new Set(),
        })
      }
      const o = optimizerMap.get(optimizer)
      o.spend += campaign.spend
      o.revenue += campaign.revenue
      o.impressions += campaign.impressions
      o.clicks += campaign.clicks
      o.installs += campaign.installs
      o.campaigns.add(campaign.campaignId)
      o.accounts.add(campaign.accountId)
    }

    // ==================== 保存到数据库 ====================

    // 永久保存规范化的 Campaign×国家日事实。只有完整分页成功的账户
    // 才会进入这里；任何 API/持久化失败都不会清空旧事实。
    await persistMetaInsightsFactSnapshots(factSnapshots)

    // 1. 保存日汇总
    const activeAccounts = [...accountMap.values()].filter(a => a.spend > 0).length
      + cachedActiveAccountCount
    const activeCampaigns = [...campaignMap.values()].filter(c => c.spend > 0).length
    const dataStatus = unavailableCount > 0
      ? 'partial'
      : cachedFallbackCount > 0
        ? 'stale'
        : 'fresh'
    
    if (!isTargetedRefresh) await AggDaily.findOneAndUpdate(
      { date },
      {
        date,
        spend: Math.round(dailyData.spend * 100) / 100,
        revenue: Math.round(dailyData.revenue * 100) / 100,
        roas: dailyData.spend > 0 ? Math.round((dailyData.revenue / dailyData.spend) * 100) / 100 : 0,
        impressions: dailyData.impressions,
        clicks: dailyData.clicks,
        installs: dailyData.installs,
        ctr: dailyData.impressions > 0 ? Math.round((dailyData.clicks / dailyData.impressions) * 10000) / 100 : 0,
        cpm: dailyData.impressions > 0 ? Math.round((dailyData.spend / dailyData.impressions) * 1000 * 100) / 100 : 0,
        cpc: dailyData.clicks > 0 ? Math.round((dailyData.spend / dailyData.clicks) * 100) / 100 : 0,
        cpi: dailyData.installs > 0 ? Math.round((dailyData.spend / dailyData.installs) * 100) / 100 : 0,
        activeCampaigns,
        activeAccounts,
        dataStatus,
        failedAccounts: errorCount,
        cachedAccounts: cachedFallbackCount,
      },
      { upsert: true }
    )

    // 2. 保存国家数据 (批量写入优化)
    const countryOps = Array.from(countryMap.values()).map(country => ({
      updateOne: {
        filter: { date, country: country.country },
        update: {
          date,
          country: country.country,
          countryName: country.countryName,
          spend: Math.round(country.spend * 100) / 100,
          revenue: Math.round(country.revenue * 100) / 100,
          roas: country.spend > 0 ? Math.round((country.revenue / country.spend) * 100) / 100 : 0,
          impressions: country.impressions,
          clicks: country.clicks,
          installs: country.installs,
          ctr: country.impressions > 0 ? Math.round((country.clicks / country.impressions) * 10000) / 100 : 0,
          campaigns: country.campaigns.size,
        },
        upsert: true
      }
    }))
    if (!isTargetedRefresh) {
      const countryKeys = Array.from(countryMap.keys())
      await AggCountry.bulkWrite([
        ...countryOps,
        {
          deleteMany: {
            filter: {
              date,
              ...(countryKeys.length > 0
                ? { country: { $nin: countryKeys } }
                : {}),
            },
          },
        },
      ])
    }

    // 保存账户维度国家数据，供组织权限范围内查询。
    // 分批写入，避免账户和国家较多时生成过大的 MongoDB 命令。
    const accountCountryBatchSize = 1000
    for (let i = 0; i < accountCountryOps.length; i += accountCountryBatchSize) {
      await AggCountryAccount.bulkWrite(
        accountCountryOps.slice(i, i + accountCountryBatchSize),
      )
    }

    // 3. 保存账户数据 (批量写入优化)
    const accountOps = Array.from(accountMap.values()).map(account => ({
      updateOne: {
        filter: { date, accountId: account.accountId },
        update: {
          date,
          accountId: account.accountId,
          accountName: account.accountName,
          spend: Math.round(account.spend * 100) / 100,
          revenue: Math.round(account.revenue * 100) / 100,
          roas: account.spend > 0 ? Math.round((account.revenue / account.spend) * 100) / 100 : 0,
          impressions: account.impressions,
          clicks: account.clicks,
          installs: account.installs,
          ctr: account.impressions > 0 ? Math.round((account.clicks / account.impressions) * 10000) / 100 : 0,
          campaigns: account.campaigns,
          status: account.status,
          dataStatus: 'fresh',
          lastSyncedAt: new Date(),
        },
        upsert: true
      }
    }))
    if (accountOps.length > 0) await AggAccount.bulkWrite(accountOps)
    if (staleAccountIds.size > 0) {
      await AggAccount.updateMany(
        {
          date,
          accountId: { $in: getAccountIdsForQuery([...staleAccountIds]) },
        },
        { $set: { dataStatus: 'stale' } },
      )
    }

    // 4. 保存广告系列数据 (批量写入优化)
    const campaignOps = Array.from(campaignMap.values())
      .filter(campaign => successfulAccountIds.has(normalizeForStorage(campaign.accountId)))
      .map(campaign => ({
      updateOne: {
        filter: { date, campaignId: campaign.campaignId },
        update: {
          date,
          campaignId: campaign.campaignId,
          campaignName: campaign.campaignName,
          accountId: campaign.accountId,
          accountName: campaign.accountName,
          optimizer: campaign.optimizer,
          spend: Math.round(campaign.spend * 100) / 100,
          revenue: Math.round(campaign.revenue * 100) / 100,
          roas: campaign.spend > 0 ? Math.round((campaign.revenue / campaign.spend) * 100) / 100 : 0,
          impressions: campaign.impressions,
          clicks: campaign.clicks,
          installs: campaign.installs,
          ctr: campaign.impressions > 0 ? Math.round((campaign.clicks / campaign.impressions) * 10000) / 100 : 0,
          cpc: campaign.clicks > 0 ? Math.round((campaign.spend / campaign.clicks) * 100) / 100 : 0,
          cpi: campaign.installs > 0 ? Math.round((campaign.spend / campaign.installs) * 100) / 100 : 0,
          status: campaign.status,
          objective: campaign.objective,
        },
        upsert: true
      }
    }))
    if (campaignOps.length > 0) await AggCampaign.bulkWrite(campaignOps)
    const campaignIdsByAccount = new Map<string, string[]>()
    for (const campaign of campaignMap.values()) {
      const accountId = normalizeForStorage(campaign.accountId)
      if (!successfulAccountIds.has(accountId)) continue
      const campaignIds = campaignIdsByAccount.get(accountId) || []
      campaignIds.push(campaign.campaignId)
      campaignIdsByAccount.set(accountId, campaignIds)
    }
    if (successfulAccountIds.size > 0) {
      await AggCampaign.bulkWrite([...successfulAccountIds].map((accountId) => {
        const campaignIds = campaignIdsByAccount.get(accountId) || []
        return {
          deleteMany: {
            filter: {
              date,
              accountId: { $in: getAccountIdsForQuery([accountId]) },
              ...(campaignIds.length > 0
                ? { campaignId: { $nin: campaignIds } }
                : {}),
            },
          },
        }
      }))
    }

    // 5. 保存投手数据 (批量写入优化)
    const optimizerOps = Array.from(optimizerMap.values()).map(optimizer => ({
      updateOne: {
        filter: { date, optimizer: optimizer.optimizer },
        update: {
          date,
          optimizer: optimizer.optimizer,
          spend: Math.round(optimizer.spend * 100) / 100,
          revenue: Math.round(optimizer.revenue * 100) / 100,
          roas: optimizer.spend > 0 ? Math.round((optimizer.revenue / optimizer.spend) * 100) / 100 : 0,
          impressions: optimizer.impressions,
          clicks: optimizer.clicks,
          installs: optimizer.installs,
          ctr: optimizer.impressions > 0 ? Math.round((optimizer.clicks / optimizer.impressions) * 10000) / 100 : 0,
          campaigns: optimizer.campaigns.size,
          accounts: optimizer.accounts.size,
        },
        upsert: true
      }
    }))
    if (!isTargetedRefresh) {
      const optimizerKeys = Array.from(optimizerMap.keys())
      await AggOptimizer.bulkWrite([
        ...optimizerOps,
        {
          deleteMany: {
            filter: {
              date,
              ...(optimizerKeys.length > 0
                ? { optimizer: { $nin: optimizerKeys } }
                : {}),
            },
          },
        },
      ])
    }

    if (isTargetedRefresh) {
      await rebuildDerivedAggregationFromSnapshots(date)
    }

    await persistMetaInsightsCoverageOutcomes(coverageOutcomes, attemptedAt)

    const duration = Date.now() - startTime
    logger.info(
      `[Aggregation] Refreshed ${date} in ${duration}ms: ${processedCount} accounts processed, `
      + `${activeCampaigns} campaigns, ${errorCount} errors, `
      + `${cachedFallbackCount} cached, ${unavailableCount} unavailable`,
    )

    return {
      processedAccountIds: [...successfulAccountIds],
      cachedAccountIds: [...cachedAccountIds],
      unavailableAccountIds: [...unavailableAccountIds],
      deferredAccountIds: [...deferredAccountIds],
    }

  } catch (error: any) {
    logger.error(`[Aggregation] Failed to refresh ${date}:`, error.message)
    return {
      processedAccountIds: [],
      cachedAccountIds: [],
      unavailableAccountIds: requestedAccountIds,
      deferredAccountIds: [],
    }
  }
}

// Every caller (cron, token recovery, account finalization, administrator)
// shares one in-process queue. This prevents separate recovery paths from
// multiplying Meta concurrency while still preserving their individual
// account/date scopes.
let aggregationRefreshQueue: Promise<void> = Promise.resolve()

export function refreshAggregation(
  date: string,
  forceRefresh = false,
  options: AggregationRefreshOptions = {},
): Promise<AggregationRefreshResult> {
  const refresh = aggregationRefreshQueue.then(() =>
    refreshAggregationNow(date, forceRefresh, options),
  )
  aggregationRefreshQueue = refresh.then(
    () => undefined,
    () => undefined,
  )
  return refresh
}

/**
 * 🔄 刷新最近 3 天的数据
 */
export async function refreshRecentDays(): Promise<void> {
  logger.info('[Aggregation] Refreshing recent 3 days...')
  // 日期串行、账户受控并发，避免手动刷新瞬间放大 3 倍 Meta 请求。
  for (const date of getMutableInsightsDates()) {
    await refreshAggregation(date)
  }
}

// ==================== 查询接口（直接读取，不刷新） ====================
// 🚀 刷新只在后台定时任务中进行，查询时直接返回数据库数据

/**
 * 📊 获取日汇总数据
 */
export async function getDailySummary(startDate: string, endDate: string) {
  return AggDaily.find({ 
    date: { $gte: startDate, $lte: endDate } 
  }).sort({ date: -1 }).lean()
}

/**
 * 🌍 获取国家数据
 */
export async function getCountryData(date: string, limit = 500) {
  return AggCountry.find({ date })
    .sort({ spend: -1 })
    .limit(limit)
    .lean()
}

/**
 * 💰 获取账户数据
 */
export async function getAccountData(date: string, limit = 500) {
  return AggAccount.find({ date })
    .sort({ spend: -1 })
    .limit(limit)
    .lean()
}

/**
 * 📈 获取广告系列数据
 */
export async function getCampaignData(date: string, options?: { optimizer?: string; accountId?: string; limit?: number }) {
  const query: any = { date }
  if (options?.optimizer) query.optimizer = options.optimizer
  if (options?.accountId) query.accountId = options.accountId

  return AggCampaign.find(query)
    .sort({ spend: -1 })
    .limit(options?.limit || 500)
    .lean()
}

/**
 * 👥 获取投手数据
 */
export async function getOptimizerData(date: string, limit = 500) {
  return AggOptimizer.find({ date })
    .sort({ spend: -1 })
    .limit(limit)
    .lean()
}

/**
 * 🎨 获取素材数据 (已废弃，请使用 summary.controller.ts 中的 MaterialMetrics 查询)
 */
export async function getMaterialData(date: string) {
  return []
}

export default {
  refreshAggregation,
  refreshRecentDays,
  getDailySummary,
  getCountryData,
  getAccountData,
  getCampaignData,
  getOptimizerData,
  getMaterialData,
}
