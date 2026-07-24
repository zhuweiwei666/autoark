import FacebookUser from '../models/FacebookUser'
import FbToken from '../models/FbToken'
import logger from '../utils/logger'
import { FB_VERSIONED_URL } from '../config/facebook.config'
import { sanitizeFacebookPages } from '../utils/facebookAssetSanitizer'
import { syncCachedAccountsForToken } from './facebook.accounts.service'

const FB_BASE_URL = FB_VERSIONED_URL
const FACEBOOK_USER_SYNC_PAGE_LIMIT = 10
const FACEBOOK_USER_SYNC_PAGE_SIZE = 100
const FACEBOOK_GRAPH_REQUEST_TIMEOUT_MS = 30 * 1000
const FACEBOOK_USER_SYNC_LEASE_MS = 30 * 60 * 1000
const FACEBOOK_USER_SYNC_HEARTBEAT_MS = 5 * 60 * 1000
const FACEBOOK_USER_SYNC_FRESH_MS = 5 * 60 * 60 * 1000
const FACEBOOK_ASSET_FALLBACK_CONCURRENCY = 5

const PIXEL_FIELDS = [
  'id',
  'name',
  'owner_business',
  'is_created_by_business',
  'creation_time',
  'last_fired_time',
  'data_use_setting',
  'enable_automatic_matching',
].join(',')

const AD_ACCOUNT_FIELDS = [
  'id',
  'account_id',
  'name',
  'account_status',
  'currency',
  'timezone_name',
  `adspixels.limit(${FACEBOOK_USER_SYNC_PAGE_SIZE}){${PIXEL_FIELDS}}`,
  `promote_pages.limit(${FACEBOOK_USER_SYNC_PAGE_SIZE}){id,name}`,
].join(',')

const BUSINESS_FIELDS = [
  'id',
  'name',
  `owned_pixels.limit(${FACEBOOK_USER_SYNC_PAGE_SIZE}){${PIXEL_FIELDS}}`,
  `owned_product_catalogs.limit(${FACEBOOK_USER_SYNC_PAGE_SIZE}){id,name}`,
].join(',')

type FacebookUserScope = {
  tokenId?: string
  organizationId?: any
}

type SyncedAdAccount = {
  accountId?: string
  name?: string
  status?: number
  currency?: string
  timezone?: string
}

type AdAccountsSyncedHandler = (accounts: SyncedAdAccount[]) => Promise<void>

type FacebookTokenAssetSource = {
  _id: any
  token: string
  fbUserId: string
  organizationId?: any
  optimizer?: string
}

export type FacebookUserAssetSyncOptions = {
  force?: boolean
  maxAgeMs?: number
}

type InFlightFacebookUserSync = {
  promise: Promise<any>
  handlers: Set<AdAccountsSyncedHandler>
  adAccounts?: SyncedAdAccount[]
}

type GraphSyncStats = {
  graphRequestCount: number
  graphFailureCount: number
  skippedInactiveAccountCount: number
  accountAssetMode: 'field_expansion' | 'hybrid_fallback'
  businessAssetMode: 'field_expansion' | 'hybrid_fallback'
}

const inFlightFacebookUserSyncs = new Map<string, InFlightFacebookUserSync>()

const buildFacebookUserFilter = (fbUserId: string, scope: FacebookUserScope = {}) => {
  const filter: any = { fbUserId }
  if (scope.organizationId) {
    filter.organizationId = scope.organizationId
  } else if (scope.tokenId) {
    filter.tokenId = scope.tokenId
  }
  return filter
}

const buildFacebookUserSyncKey = (
  fbUserId: string,
  tokenId?: string,
  organizationId?: any,
) => `${organizationId?.toString?.() || 'global'}:${tokenId || fbUserId}`

/**
 * 同步 Facebook 用户的所有资产（Pixels、账户、粉丝页、Catalog）
 */
const runFacebookUserAssetSync = async (
  fbUserId: string,
  accessToken: string,
  tokenId?: string,
  organizationId?: any,
  onAdAccountsSynced?: AdAccountsSyncedHandler,
  options: FacebookUserAssetSyncOptions = {},
) => {
  const userFilter = buildFacebookUserFilter(fbUserId, { tokenId, organizationId })
  let cachedSnapshot: any = await FacebookUser.findOne(userFilter)
  const maxAgeMs = options.maxAgeMs ?? FACEBOOK_USER_SYNC_FRESH_MS
  const lastSyncedAt = cachedSnapshot?.lastSyncedAt
    ? new Date(cachedSnapshot.lastSyncedAt).getTime()
    : 0
  const leaseExpiresAt = cachedSnapshot?.syncLeaseExpiresAt
    ? new Date(cachedSnapshot.syncLeaseExpiresAt).getTime()
    : 0
  const fresh = (
    cachedSnapshot?.syncStatus === 'completed' &&
    lastSyncedAt > 0 &&
    lastSyncedAt >= Date.now() - maxAgeMs
  )
  const alreadySyncing = (
    cachedSnapshot?.syncStatus === 'syncing' &&
    leaseExpiresAt > Date.now()
  )

  if (alreadySyncing || (!options.force && fresh)) {
    logger.info(
      `[FacebookUser] Reusing ${fresh ? 'fresh' : 'in-progress'} asset snapshot for user ${fbUserId}`,
    )
    if (onAdAccountsSynced) {
      await onAdAccountsSynced(cachedSnapshot.adAccounts || [])
    }
    return cachedSnapshot
  }

  const syncStartedAt = new Date()
  const claimConditions: any[] = [
    {
      $or: [
        { syncStatus: { $ne: 'syncing' } },
        { syncLeaseExpiresAt: { $exists: false } },
        { syncLeaseExpiresAt: { $lte: syncStartedAt } },
      ],
    },
  ]
  if (!options.force) {
    claimConditions.push({
      $or: [
        { syncStatus: { $ne: 'completed' } },
        { lastSyncedAt: { $exists: false } },
        { lastSyncedAt: { $lt: new Date(syncStartedAt.getTime() - maxAgeMs) } },
      ],
    })
  }

  let claimedSnapshot: any
  try {
    claimedSnapshot = await FacebookUser.findOneAndUpdate(
      { $and: [userFilter, ...claimConditions] },
      {
        fbUserId,
        tokenId,
        ...(organizationId && { organizationId }),
        syncStatus: 'syncing',
        syncStartedAt,
        syncLeaseExpiresAt: new Date(syncStartedAt.getTime() + FACEBOOK_USER_SYNC_LEASE_MS),
        $unset: { syncError: 1 },
      },
      { upsert: !cachedSnapshot, new: true },
    )
  } catch (error: any) {
    if (Number(error?.code) !== 11000) throw error
  }

  if (!claimedSnapshot) {
    cachedSnapshot = await FacebookUser.findOne(userFilter)
    if (!cachedSnapshot) {
      throw new Error(`Facebook asset sync lease could not be acquired for ${fbUserId}`)
    }
    logger.info(`[FacebookUser] Another process acquired the asset sync for user ${fbUserId}`)
    if (onAdAccountsSynced) {
      await onAdAccountsSynced(cachedSnapshot.adAccounts || [])
    }
    return cachedSnapshot
  }

  logger.info(`[FacebookUser] Starting sync for user ${fbUserId}`)
  const leaseOwnerFilter = { ...userFilter, syncStartedAt }
  let lastLeaseRenewedAt = syncStartedAt.getTime()
  const graphStats: GraphSyncStats = {
    graphRequestCount: 0,
    graphFailureCount: 0,
    skippedInactiveAccountCount: 0,
    accountAssetMode: 'field_expansion',
    businessAssetMode: 'field_expansion',
  }

  const renewSyncLease = async () => {
    const now = Date.now()
    if (now - lastLeaseRenewedAt < FACEBOOK_USER_SYNC_HEARTBEAT_MS) return
    const renewed = await FacebookUser.findOneAndUpdate(
      leaseOwnerFilter,
      { syncLeaseExpiresAt: new Date(now + FACEBOOK_USER_SYNC_LEASE_MS) },
    )
    if (!renewed) throw new Error(`Facebook asset sync lease lost for ${fbUserId}`)
    lastLeaseRenewedAt = now
  }
  
  try {
    // 先并行启动用户级资产查询；账户目录一返回就先落库并通知调用方。
    const tokenPixelsPromise = fetchTokenPixels(accessToken, graphStats)
    const userPagesPromise = fetchOptionalGraphCollection(
      '/me/accounts',
      accessToken,
      { fields: 'id,name,access_token' },
      graphStats,
      'user pages',
    )
    const businessesPromise = fetchBusinesses(accessToken, graphStats)

    // 1. 广告账户字段展开会同时带回账户级 Pixel/Page，避免逐账户重复请求。
    const accountResult = await fetchAdAccounts(accessToken, graphStats)
    const accounts = accountResult.items
    logger.info(`[FacebookUser] Found ${accounts.length} ad accounts`)
    const adAccounts = accounts.map(acc => ({
      accountId: acc.account_id || acc.id?.replace('act_', ''),
      name: acc.name,
      status: acc.account_status,
      currency: acc.currency,
      timezone: acc.timezone_name,
    }))

    // 广告账户是后续所有资产扫描的基础，先落库，避免 Page/Pixel 扫描期间前端继续显示旧数据。
    const accountCheckpoint = await FacebookUser.findOneAndUpdate(
      leaseOwnerFilter,
      {
        fbUserId,
        tokenId,
        ...(organizationId && { organizationId }),
        adAccounts,
        adAccountsFetchedPageCount: accountResult.pageCount,
        adAccountsPaginationTruncated: accountResult.truncated,
        syncStatus: 'syncing',
        $unset: { syncError: 1 },
      },
      { new: true },
    )
    if (!accountCheckpoint) {
      throw new Error(`Facebook asset sync lease lost for ${fbUserId}`)
    }

    // 账户目录不需要等待逐账户的 Pixel/Page 扫描。回调失败只记录，不阻断其他资产同步。
    if (onAdAccountsSynced) {
      try {
        await onAdAccountsSynced(adAccounts)
      } catch (error: any) {
        logger.error(`[FacebookUser] Failed to import account catalog for ${fbUserId}:`, error)
      }
    }
    
    const [tokenPixels, userPages, businessResult] = await Promise.all([
      tokenPixelsPromise,
      userPagesPromise,
      businessesPromise,
    ])

    // 2. 先保存 token 本身可见的 Pixels，再补充活跃广告账户关联。
    const pixelMap = new Map<string, any>()
    for (const pixel of tokenPixels) {
      mergePixel(pixelMap, pixel)
    }

    // 3. 用户直接管理的 Page 属于 token 资产，但不能伪装成每个账户都可推广。
    const pagesMap = new Map<string, any>()
    for (const page of userPages) {
      mergePage(pagesMap, page)
    }

    await mapWithConcurrency(accounts, FACEBOOK_ASSET_FALLBACK_CONCURRENCY, async (account) => {
      const accountId = account.account_id || account.id?.replace('act_', '')
      const active = Number(account.account_status) === 1
      const embeddedPixels = getEmbeddedCollection(account.adspixels)
      const embeddedPages = getEmbeddedCollection(account.promote_pages)

      if ((!embeddedPixels.present || !embeddedPages.present) && !active) {
        graphStats.skippedInactiveAccountCount += 1
      }
      if (!embeddedPixels.present || !embeddedPages.present) {
        graphStats.accountAssetMode = 'hybrid_fallback'
      }

      const pixelsPromise = embeddedPixels.present
        ? completeEmbeddedCollection(embeddedPixels, accessToken, graphStats)
        : active
          ? fetchOptionalGraphCollection(
              `/act_${accountId}/adspixels`,
              accessToken,
              { fields: PIXEL_FIELDS },
              graphStats,
              `pixels for account ${accountId}`,
            )
          : Promise.resolve([])
      const pagesPromise = embeddedPages.present
        ? completeEmbeddedCollection(embeddedPages, accessToken, graphStats)
        : active
          ? fetchOptionalGraphCollection(
              `/act_${accountId}/promote_pages`,
              accessToken,
              { fields: 'id,name' },
              graphStats,
              `pages for account ${accountId}`,
            )
          : Promise.resolve([])

      const [pixels, pages] = await Promise.all([pixelsPromise, pagesPromise])
      for (const pixel of pixels) {
        mergePixel(pixelMap, pixel, {
          accountId,
          accountName: account.name,
        })
      }
      for (const page of pages) {
        mergePage(pagesMap, page, accountId)
      }
      await renewSyncLease()
    })

    // 3.1 Business 资产优先走字段展开；仅对缺失字段的 Business 降级。
    const catalogsMap = new Map<string, any>()
    await mapWithConcurrency(
      businessResult.items,
      FACEBOOK_ASSET_FALLBACK_CONCURRENCY,
      async (business) => {
        const embeddedBusinessPixels = getEmbeddedCollection(business.owned_pixels)
        if (!embeddedBusinessPixels.present) {
          graphStats.businessAssetMode = 'hybrid_fallback'
        }
        const businessPixels = embeddedBusinessPixels.present
          ? await completeEmbeddedCollection(
              embeddedBusinessPixels,
              accessToken,
              graphStats,
            )
          : await fetchOptionalGraphCollection(
              `/${business.id}/owned_pixels`,
              accessToken,
              { fields: PIXEL_FIELDS },
              graphStats,
              `pixels for business ${business.id}`,
            )
        for (const pixel of businessPixels) {
          mergePixel(pixelMap, pixel)
        }

        const embeddedCatalogs = getEmbeddedCollection(business.owned_product_catalogs)
        if (!embeddedCatalogs.present) {
          graphStats.businessAssetMode = 'hybrid_fallback'
        }
        const catalogs = embeddedCatalogs.present
          ? await completeEmbeddedCollection(embeddedCatalogs, accessToken, graphStats)
          : await fetchOptionalGraphCollection(
              `/${business.id}/owned_product_catalogs`,
              accessToken,
              { fields: 'id,name' },
              graphStats,
              `catalogs for business ${business.id}`,
            )
        for (const catalog of catalogs) {
          if (!catalogsMap.has(catalog.id)) {
            catalogsMap.set(catalog.id, {
              catalogId: catalog.id,
              name: catalog.name,
              business: { id: business.id, name: business.name },
              lastSyncedAt: new Date(),
            })
          }
        }
        await renewSyncLease()
      },
    )
    logger.info(
      `[FacebookUser] Found ${catalogsMap.size} catalogs across ${businessResult.items.length} businesses`,
    )
    
    // 4. 保存到数据库
    const result = await FacebookUser.findOneAndUpdate(
      leaseOwnerFilter,
      {
        fbUserId,
        tokenId,
        ...(organizationId && { organizationId }),
        pixels: Array.from(pixelMap.values()),
        adAccounts,
        adAccountsFetchedPageCount: accountResult.pageCount,
        adAccountsPaginationTruncated: accountResult.truncated,
        pages: Array.from(pagesMap.values()),
        productCatalogs: Array.from(catalogsMap.values()),
        syncStats: graphStats,
        lastSyncedAt: new Date(),
        syncStatus: 'completed',
        $unset: { syncError: 1, syncLeaseExpiresAt: 1 },
      },
      { new: true }
    )
    if (!result) throw new Error(`Facebook asset sync lease lost for ${fbUserId}`)
    
    logger.info(
      `[FacebookUser] Sync completed for ${fbUserId}: ${pixelMap.size} pixels, ` +
      `${accounts.length} accounts, ${pagesMap.size} pages, ${catalogsMap.size} catalogs, ` +
      `${graphStats.graphRequestCount} Graph requests`,
    )
    
    return result
  } catch (error: any) {
    logger.error(`[FacebookUser] Sync failed for ${fbUserId}:`, error)
    
    await FacebookUser.findOneAndUpdate(
      leaseOwnerFilter,
      { 
        syncStatus: 'failed',
        syncError: error.message,
        $unset: { syncLeaseExpiresAt: 1 },
      }
    )
    
    throw error
  }
}

export const syncFacebookUserAssets = (
  fbUserId: string,
  accessToken: string,
  tokenId?: string,
  organizationId?: any,
  onAdAccountsSynced?: AdAccountsSyncedHandler,
  options: FacebookUserAssetSyncOptions = {},
) => {
  const syncKey = buildFacebookUserSyncKey(fbUserId, tokenId, organizationId)
  const existingSync = inFlightFacebookUserSyncs.get(syncKey)
  if (existingSync) {
    if (onAdAccountsSynced) {
      if (existingSync.adAccounts) {
        void onAdAccountsSynced(existingSync.adAccounts).catch((error: any) => {
          logger.error(`[FacebookUser] Failed to import account catalog for ${fbUserId}:`, error)
        })
      } else {
        existingSync.handlers.add(onAdAccountsSynced)
      }
    }
    logger.info(`[FacebookUser] Reusing in-flight sync for user ${fbUserId}`)
    return existingSync.promise
  }

  const syncEntry: InFlightFacebookUserSync = {
    promise: undefined as any,
    handlers: new Set(onAdAccountsSynced ? [onAdAccountsSynced] : []),
  }
  const notifyAdAccountsSynced: AdAccountsSyncedHandler = async (adAccounts) => {
    syncEntry.adAccounts = adAccounts
    const handlers = Array.from(syncEntry.handlers)
    syncEntry.handlers.clear()
    for (const handler of handlers) {
      try {
        await handler(adAccounts)
      } catch (error: any) {
        logger.error(`[FacebookUser] Failed to import account catalog for ${fbUserId}:`, error)
      }
    }
  }

  const sync = runFacebookUserAssetSync(
    fbUserId,
    accessToken,
    tokenId,
    organizationId,
    notifyAdAccountsSynced,
    options,
  ).finally(() => {
    if (inFlightFacebookUserSyncs.get(syncKey)?.promise === sync) {
      inFlightFacebookUserSyncs.delete(syncKey)
    }
  })
  syncEntry.promise = sync
  inFlightFacebookUserSyncs.set(syncKey, syncEntry)
  return sync
}

export const syncFacebookTokenAssets = (
  tokenDoc: FacebookTokenAssetSource,
  options: FacebookUserAssetSyncOptions = {},
) => syncFacebookUserAssets(
  tokenDoc.fbUserId,
  tokenDoc.token,
  String(tokenDoc._id),
  tokenDoc.organizationId,
  async (adAccounts) => {
    await syncCachedAccountsForToken(tokenDoc, adAccounts)
    await FbToken.findByIdAndUpdate(tokenDoc._id, { lastAccountSyncedAt: new Date() })
  },
  options,
)

/**
 * 获取缓存的 Pixels
 */
export const getCachedPixels = async (fbUserId: string, scope: FacebookUserScope = {}) => {
  const user = await FacebookUser.findOne(buildFacebookUserFilter(fbUserId, scope))
  return user?.pixels || []
}

/**
 * 获取缓存的账户
 */
export const getCachedAccounts = async (fbUserId: string, scope: FacebookUserScope = {}) => {
  const snapshot = await getCachedAccountsWithMeta(fbUserId, scope)
  return snapshot.accounts
}

export const getCachedAccountsWithMeta = async (fbUserId: string, scope: FacebookUserScope = {}) => {
  const user = await FacebookUser.findOne(buildFacebookUserFilter(fbUserId, scope))
  return {
    accounts: user?.adAccounts || [],
    fetchedPageCount: user?.adAccountsFetchedPageCount || 0,
    paginationTruncated: Boolean(user?.adAccountsPaginationTruncated),
  }
}

/**
 * 获取缓存的粉丝页
 */
export const getCachedPages = async (fbUserId: string, accountId?: string, scope: FacebookUserScope = {}) => {
  const user = await FacebookUser.findOne(buildFacebookUserFilter(fbUserId, scope))
  if (!user?.pages) return []
  
  if (accountId) {
    // 筛选该账户可用的粉丝页
    return sanitizeFacebookPages(user.pages.filter((p: any) =>
      p.accounts?.some((a: any) => a.accountId === accountId)
    ))
  }
  
  return sanitizeFacebookPages(user.pages)
}

/**
 * 获取缓存的 Catalogs
 */
export const getCachedCatalogs = async (fbUserId: string, scope: FacebookUserScope = {}) => {
  const user = await FacebookUser.findOne(buildFacebookUserFilter(fbUserId, scope))
  return user?.productCatalogs || []
}

/**
 * 获取同步状态
 */
export const getSyncStatus = async (fbUserId: string, scope: FacebookUserScope = {}) => {
  const user = await FacebookUser.findOne(buildFacebookUserFilter(fbUserId, scope))
  const rawStatus = user?.syncStatus || 'pending'
  const explicitLeaseExpiry = user?.syncLeaseExpiresAt
    ? new Date(user.syncLeaseExpiresAt).getTime()
    : undefined
  const legacyLeaseExpiry = user?.updatedAt
    ? new Date(user.updatedAt).getTime() + FACEBOOK_USER_SYNC_LEASE_MS
    : undefined
  const leaseExpiry = explicitLeaseExpiry || legacyLeaseExpiry
  const stale = rawStatus === 'syncing' && (!leaseExpiry || leaseExpiry <= Date.now())
  const status = stale ? 'failed' : rawStatus
  return {
    status,
    stale,
    retryable: status === 'failed',
    syncStartedAt: user?.syncStartedAt,
    syncLeaseExpiresAt: user?.syncLeaseExpiresAt,
    lastSyncedAt: user?.lastSyncedAt,
    error: stale ? '上次 Facebook 资产同步已中断或超时，可以重新同步。' : user?.syncError,
    pixelCount: user?.pixels?.length || 0,
    accountCount: user?.adAccounts?.length || 0,
    pageCount: user?.pages?.length || 0,
    catalogCount: user?.productCatalogs?.length || 0,
    syncStats: user?.syncStats,
  }
}

// ============ Helper Functions ============

type GraphCollectionResult = {
  items: any[]
  pageCount: number
  truncated: boolean
}

type EmbeddedCollection = {
  present: boolean
  items: any[]
  nextUrl?: string
}

async function fetchGraphCollectionWithMeta(
  path: string,
  accessToken: string,
  params: Record<string, string | number> = {},
  stats?: GraphSyncStats,
): Promise<GraphCollectionResult> {
  const url = new URL(`${FB_BASE_URL}${path}`)
  const initialParams = {
    limit: FACEBOOK_USER_SYNC_PAGE_SIZE,
    ...params,
    access_token: accessToken,
  }

  for (const [key, value] of Object.entries(initialParams)) {
    url.searchParams.set(key, String(value))
  }

  return fetchGraphCollectionFromUrl(url.toString(), accessToken, stats)
}

async function fetchGraphCollectionFromUrl(
  initialUrl: string,
  accessToken: string,
  stats?: GraphSyncStats,
): Promise<GraphCollectionResult> {
  const items: any[] = []
  let nextUrl: string | undefined = initialUrl
  let pageCount = 0
  while (nextUrl && pageCount < FACEBOOK_USER_SYNC_PAGE_LIMIT) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FACEBOOK_GRAPH_REQUEST_TIMEOUT_MS)
    let data: any
    if (stats) stats.graphRequestCount += 1
    try {
      const response = await fetch(nextUrl, { signal: controller.signal })
      data = await response.json()
      if (response.ok === false && !data?.error) {
        throw new Error(`Facebook Graph request failed with HTTP ${response.status}`)
      }
      if (data?.error) {
        const graphError: any = new Error(
          data.error.message || 'Facebook Graph request failed',
        )
        graphError.code = data.error.code
        graphError.errorSubcode = data.error.error_subcode
        graphError.type = data.error.type
        throw graphError
      }
    } catch (error) {
      if (stats) stats.graphFailureCount += 1
      throw error
    } finally {
      clearTimeout(timeoutId)
    }

    items.push(...(data.data || []))
    pageCount += 1
    if (data.paging?.next) {
      const next = new URL(data.paging.next)
      if (!next.searchParams.has('access_token')) {
        next.searchParams.set('access_token', accessToken)
      }
      nextUrl = next.toString()
    } else {
      nextUrl = undefined
    }
  }

  return {
    items,
    pageCount,
    truncated: Boolean(nextUrl),
  }
}

async function fetchGraphCollection(
  path: string,
  accessToken: string,
  params: Record<string, string | number> = {},
  stats?: GraphSyncStats,
): Promise<any[]> {
  const result = await fetchGraphCollectionWithMeta(path, accessToken, params, stats)
  return result.items
}

async function fetchOptionalGraphCollection(
  path: string,
  accessToken: string,
  params: Record<string, string | number>,
  stats: GraphSyncStats,
  label: string,
): Promise<any[]> {
  try {
    return await fetchGraphCollection(path, accessToken, params, stats)
  } catch (error: any) {
    logger.warn(`[FacebookUser] Failed to fetch ${label}: ${error?.message || error}`)
    return []
  }
}

async function fetchTokenPixels(
  accessToken: string,
  stats: GraphSyncStats,
): Promise<any[]> {
  try {
    return await fetchGraphCollection(
      '/me/adspixels',
      accessToken,
      { fields: PIXEL_FIELDS },
      stats,
    )
  } catch (error: any) {
    if (!isAssetConnectionUnavailable(error)) throw error
    logger.warn(
      `[FacebookUser] Token-level pixels unavailable; using account/business assets: ` +
      `${error?.message || error}`,
    )
    return []
  }
}

async function fetchAdAccounts(
  accessToken: string,
  stats: GraphSyncStats,
): Promise<GraphCollectionResult> {
  try {
    return await fetchGraphCollectionWithMeta(
      '/me/adaccounts',
      accessToken,
      { fields: AD_ACCOUNT_FIELDS },
      stats,
    )
  } catch (error: any) {
    if (!isFieldExpansionError(error)) throw error
    logger.warn(
      `[FacebookUser] Ad account field expansion failed; using active-account fallback: ` +
      `${error?.message || error}`,
    )
    stats.accountAssetMode = 'hybrid_fallback'
    return fetchGraphCollectionWithMeta(
      '/me/adaccounts',
      accessToken,
      { fields: 'id,account_id,name,account_status,currency,timezone_name' },
      stats,
    )
  }
}

async function fetchBusinesses(
  accessToken: string,
  stats: GraphSyncStats,
): Promise<GraphCollectionResult> {
  try {
    return await fetchGraphCollectionWithMeta(
      '/me/businesses',
      accessToken,
      { fields: BUSINESS_FIELDS },
      stats,
    )
  } catch (error: any) {
    if (!isFieldExpansionError(error)) {
      logger.warn(
        `[FacebookUser] Failed to fetch businesses (optional): ${error?.message || error}`,
      )
      return { items: [], pageCount: 0, truncated: false }
    }
    logger.warn(
      `[FacebookUser] Business field expansion failed; using per-business fallback: ` +
      `${error?.message || error}`,
    )
    stats.businessAssetMode = 'hybrid_fallback'
    try {
      return await fetchGraphCollectionWithMeta(
        '/me/businesses',
        accessToken,
        { fields: 'id,name' },
        stats,
      )
    } catch (fallbackError: any) {
      logger.warn(
        `[FacebookUser] Failed to fetch businesses (optional): ` +
        `${fallbackError?.message || fallbackError}`,
      )
      return { items: [], pageCount: 0, truncated: false }
    }
  }
}

const isFieldExpansionError = (error: any) => (
  Number(error?.code) === 100 ||
  /nonexisting field|unknown field|invalid field|cannot query field|syntax error/i
    .test(error?.message || '')
)

const isAssetConnectionUnavailable = (error: any) => (
  [10, 100, 200].includes(Number(error?.code)) ||
  /unsupported get request|permissions? error|does not have permission/i
    .test(error?.message || '')
)

const getEmbeddedCollection = (value: any): EmbeddedCollection => ({
  present: value !== undefined && value !== null,
  items: Array.isArray(value) ? value : (value?.data || []),
  nextUrl: value?.paging?.next,
})

async function completeEmbeddedCollection(
  embedded: EmbeddedCollection,
  accessToken: string,
  stats: GraphSyncStats,
): Promise<any[]> {
  if (!embedded.nextUrl) return embedded.items
  const remainder = await fetchGraphCollectionFromUrl(embedded.nextUrl, accessToken, stats)
  return [...embedded.items, ...remainder.items]
}

const mergePixel = (
  pixelMap: Map<string, any>,
  pixel: any,
  account?: { accountId: string; accountName?: string },
) => {
  if (!pixel?.id) return
  const ownerBusiness = pixel.owner_business || pixel.ownerBusiness
  const candidate = {
    pixelId: pixel.id,
    name: pixel.name || 'Unnamed Pixel',
    ownerBusiness: ownerBusiness
      ? { id: ownerBusiness.id, name: ownerBusiness.name }
      : undefined,
    isCreatedByBusiness: pixel.is_created_by_business ?? pixel.isCreatedByBusiness,
    creationTime: pixel.creation_time || pixel.creationTime,
    lastFiredTime: pixel.last_fired_time || pixel.lastFiredTime,
    dataUseSetting: pixel.data_use_setting || pixel.dataUseSetting,
    enableAutomaticMatching:
      pixel.enable_automatic_matching ?? pixel.enableAutomaticMatching,
    accounts: [] as Array<{ accountId: string; accountName?: string }>,
    lastSyncedAt: new Date(),
  }
  const existing = pixelMap.get(pixel.id)
  if (!existing) {
    pixelMap.set(pixel.id, candidate)
  } else {
    for (const [key, value] of Object.entries(candidate)) {
      if (value !== undefined && key !== 'accounts') {
        existing[key] = value
      }
    }
  }

  if (account) {
    const merged = pixelMap.get(pixel.id)
    if (!merged.accounts.some((item: any) => item.accountId === account.accountId)) {
      merged.accounts.push(account)
    }
  }
}

const mergePage = (
  pagesMap: Map<string, any>,
  page: any,
  accountId?: string,
) => {
  if (!page?.id) return
  if (!pagesMap.has(page.id)) {
    pagesMap.set(page.id, {
      pageId: page.id,
      name: page.name,
      accessToken: page.access_token,
      accounts: [],
    })
  }
  const existing = pagesMap.get(page.id)
  if (!existing.name && page.name) existing.name = page.name
  if (!existing.accessToken && page.access_token) existing.accessToken = page.access_token
  if (accountId && !existing.accounts.some((item: any) => item.accountId === accountId)) {
    existing.accounts.push({ accountId })
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        await worker(items[currentIndex])
      }
    },
  )
  await Promise.all(workers)
}

export default {
  syncFacebookUserAssets,
  syncFacebookTokenAssets,
  getCachedPixels,
  getCachedAccounts,
  getCachedAccountsWithMeta,
  getCachedPages,
  getCachedCatalogs,
  getSyncStatus,
}
