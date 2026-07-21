import FacebookUser from '../models/FacebookUser'
import logger from '../utils/logger'
import { FB_VERSIONED_URL } from '../config/facebook.config'
import { sanitizeFacebookPages } from '../utils/facebookAssetSanitizer'

const FB_BASE_URL = FB_VERSIONED_URL
const FACEBOOK_USER_SYNC_PAGE_LIMIT = 10
const FACEBOOK_USER_SYNC_PAGE_SIZE = 100
const FACEBOOK_GRAPH_REQUEST_TIMEOUT_MS = 30 * 1000
const FACEBOOK_USER_SYNC_LEASE_MS = 30 * 60 * 1000
const FACEBOOK_USER_SYNC_HEARTBEAT_MS = 5 * 60 * 1000
const inFlightFacebookUserSyncs = new Map<string, Promise<any>>()

type FacebookUserScope = {
  tokenId?: string
  organizationId?: any
}

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
) => {
  logger.info(`[FacebookUser] Starting sync for user ${fbUserId}`)
  const userFilter = buildFacebookUserFilter(fbUserId, { tokenId, organizationId })
  const syncStartedAt = new Date()
  let lastLeaseRenewedAt = syncStartedAt.getTime()

  const renewSyncLease = async () => {
    const now = Date.now()
    if (now - lastLeaseRenewedAt < FACEBOOK_USER_SYNC_HEARTBEAT_MS) return
    await FacebookUser.findOneAndUpdate(
      userFilter,
      { syncLeaseExpiresAt: new Date(now + FACEBOOK_USER_SYNC_LEASE_MS) },
    )
    lastLeaseRenewedAt = now
  }
  
  try {
    // 更新同步状态
    await FacebookUser.findOneAndUpdate(
      userFilter,
      { 
        fbUserId,
        tokenId,
        ...(organizationId && { organizationId }),
        syncStatus: 'syncing',
        syncStartedAt,
        syncLeaseExpiresAt: new Date(syncStartedAt.getTime() + FACEBOOK_USER_SYNC_LEASE_MS),
        $unset: { syncError: 1 }
      },
      { upsert: true, new: true }
    )
    
    // 1. 获取所有广告账户
    const accounts = await fetchAdAccounts(accessToken)
    logger.info(`[FacebookUser] Found ${accounts.length} ad accounts`)
    const adAccounts = accounts.map(acc => ({
      accountId: acc.account_id || acc.id?.replace('act_', ''),
      name: acc.name,
      status: acc.account_status,
      currency: acc.currency,
      timezone: acc.timezone_name,
    }))

    // 广告账户是后续所有资产扫描的基础，先落库，避免 Page/Pixel 扫描期间前端继续显示旧数据。
    await FacebookUser.findOneAndUpdate(
      userFilter,
      {
        fbUserId,
        tokenId,
        ...(organizationId && { organizationId }),
        adAccounts,
        syncStatus: 'syncing',
        $unset: { syncError: 1 },
      },
      { upsert: true, new: true },
    )
    
    // 2. 获取所有 Pixels（汇总所有账户的）
    const pixelMap = new Map<string, any>()
    
    for (const account of accounts) {
      const accountId = account.account_id || account.id?.replace('act_', '')
      try {
        const pixels = await fetchAccountPixels(accountId, accessToken)
        for (const pixel of pixels) {
          if (!pixelMap.has(pixel.id)) {
            pixelMap.set(pixel.id, {
              pixelId: pixel.id,
              name: pixel.name,
              accounts: [{ accountId, accountName: account.name }],
              lastSyncedAt: new Date(),
            })
          } else {
            const existing = pixelMap.get(pixel.id)
            // 检查账户是否已存在
            if (!existing.accounts.find((a: any) => a.accountId === accountId)) {
              existing.accounts.push({ accountId, accountName: account.name })
            }
          }
        }
      } catch (err) {
        logger.warn(`[FacebookUser] Failed to fetch pixels for account ${accountId}:`, err)
      } finally {
        await renewSyncLease()
      }
    }
    
    // 3. 获取所有粉丝页
    const pagesMap = new Map<string, any>()
    
    let fallbackUserPagesPromise: Promise<any[]> | undefined
    const getFallbackUserPages = () => {
      if (!fallbackUserPagesPromise) {
        fallbackUserPagesPromise = fetchUserPages(accessToken)
      }
      return fallbackUserPagesPromise
    }

    for (const account of accounts) {
      const accountId = account.account_id || account.id?.replace('act_', '')
      try {
        const pages = await fetchAccountPages(accountId, accessToken, getFallbackUserPages)
        for (const page of pages) {
          if (!pagesMap.has(page.id)) {
            pagesMap.set(page.id, {
              pageId: page.id,
              name: page.name,
              accounts: [{ accountId }],
            })
          } else {
            const existing = pagesMap.get(page.id)
            if (!existing.accounts.find((a: any) => a.accountId === accountId)) {
              existing.accounts.push({ accountId })
            }
          }
        }
      } catch (err) {
        logger.warn(`[FacebookUser] Failed to fetch pages for account ${accountId}:`, err)
      } finally {
        await renewSyncLease()
      }
    }
    
    // 3.1 获取 Catalogs（需要 catalog_management 权限；没有则忽略）
    const catalogsMap = new Map<string, any>()
    try {
      const businesses = await fetchBusinesses(accessToken)
      for (const b of businesses) {
        try {
          const catalogs = await fetchBusinessCatalogs(b.id, accessToken)
          for (const c of catalogs) {
            if (!catalogsMap.has(c.id)) {
              catalogsMap.set(c.id, {
                catalogId: c.id,
                name: c.name,
                business: { id: b.id, name: b.name },
                lastSyncedAt: new Date(),
              })
            }
          }
        } catch (e) {
          // 继续下一个 business
        } finally {
          await renewSyncLease()
        }
      }
      logger.info(`[FacebookUser] Found ${catalogsMap.size} catalogs across ${businesses.length} businesses`)
    } catch (e: any) {
      // 如果缺少权限，这里通常会报错，直接降级不阻塞主流程
      logger.warn(`[FacebookUser] Failed to fetch catalogs (optional): ${e?.message || e}`)
    }
    
    // 4. 保存到数据库
    const result = await FacebookUser.findOneAndUpdate(
      userFilter,
      {
        fbUserId,
        tokenId,
        ...(organizationId && { organizationId }),
        pixels: Array.from(pixelMap.values()),
        adAccounts,
        pages: Array.from(pagesMap.values()),
        productCatalogs: Array.from(catalogsMap.values()),
        lastSyncedAt: new Date(),
        syncStatus: 'completed',
        $unset: { syncError: 1, syncLeaseExpiresAt: 1 },
      },
      { upsert: true, new: true }
    )
    
    logger.info(`[FacebookUser] Sync completed for ${fbUserId}: ${pixelMap.size} pixels, ${accounts.length} accounts, ${pagesMap.size} pages, ${catalogsMap.size} catalogs`)
    
    return result
  } catch (error: any) {
    logger.error(`[FacebookUser] Sync failed for ${fbUserId}:`, error)
    
    await FacebookUser.findOneAndUpdate(
      userFilter,
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
) => {
  const syncKey = buildFacebookUserSyncKey(fbUserId, tokenId, organizationId)
  const existingSync = inFlightFacebookUserSyncs.get(syncKey)
  if (existingSync) {
    logger.info(`[FacebookUser] Reusing in-flight sync for user ${fbUserId}`)
    return existingSync
  }

  const sync = runFacebookUserAssetSync(
    fbUserId,
    accessToken,
    tokenId,
    organizationId,
  ).finally(() => {
    if (inFlightFacebookUserSyncs.get(syncKey) === sync) {
      inFlightFacebookUserSyncs.delete(syncKey)
    }
  })
  inFlightFacebookUserSyncs.set(syncKey, sync)
  return sync
}

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
  const user = await FacebookUser.findOne(buildFacebookUserFilter(fbUserId, scope))
  return user?.adAccounts || []
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
  }
}

// ============ Helper Functions ============

async function fetchGraphCollection(
  path: string,
  accessToken: string,
  params: Record<string, string | number> = {},
): Promise<any[]> {
  const items: any[] = []
  const url = new URL(`${FB_BASE_URL}${path}`)
  const initialParams = {
    limit: FACEBOOK_USER_SYNC_PAGE_SIZE,
    ...params,
    access_token: accessToken,
  }

  for (const [key, value] of Object.entries(initialParams)) {
    url.searchParams.set(key, String(value))
  }

  let nextUrl: string | undefined = url.toString()
  let pageCount = 0
  while (nextUrl && pageCount < FACEBOOK_USER_SYNC_PAGE_LIMIT) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FACEBOOK_GRAPH_REQUEST_TIMEOUT_MS)
    let data: any
    try {
      const response = await fetch(nextUrl, { signal: controller.signal })
      data = await response.json()
    } finally {
      clearTimeout(timeoutId)
    }
    
    if (data.error) {
      throw new Error(data.error.message)
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

  return items
}

async function fetchAdAccounts(accessToken: string): Promise<any[]> {
  return fetchGraphCollection('/me/adaccounts', accessToken, {
    fields: 'id,account_id,name,account_status,currency,timezone_name',
  })
}

async function fetchAccountPixels(accountId: string, accessToken: string): Promise<any[]> {
  return fetchGraphCollection(`/act_${accountId}/adspixels`, accessToken, {
    fields: 'id,name',
  })
}

async function fetchAccountPages(
  accountId: string,
  accessToken: string,
  getFallbackUserPages: () => Promise<any[]>,
): Promise<any[]> {
  const pages = await fetchGraphCollection(`/act_${accountId}/promote_pages`, accessToken, {
    fields: 'id,name,access_token',
  })

  if (pages.length > 0) {
    return pages
  }

  return getFallbackUserPages()
}

async function fetchUserPages(accessToken: string): Promise<any[]> {
  return fetchGraphCollection('/me/accounts', accessToken, {
    fields: 'id,name,access_token',
  })
}

async function fetchBusinesses(accessToken: string): Promise<any[]> {
  return fetchGraphCollection('/me/businesses', accessToken, {
    fields: 'id,name',
  })
}

async function fetchBusinessCatalogs(businessId: string, accessToken: string): Promise<any[]> {
  // owned_product_catalogs 需要 catalog_management；拿不到就会报权限错误
  return fetchGraphCollection(`/${businessId}/owned_product_catalogs`, accessToken, {
    fields: 'id,name',
  })
}

export default {
  syncFacebookUserAssets,
  getCachedPixels,
  getCachedAccounts,
  getCachedPages,
  getCachedCatalogs,
  getSyncStatus,
}
