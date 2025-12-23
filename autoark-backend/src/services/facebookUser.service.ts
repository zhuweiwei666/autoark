import FacebookUser from '../models/FacebookUser'
import logger from '../utils/logger'

const FB_API_VERSION = 'v21.0'
const FB_BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`

/**
 * 同步 Facebook 用户的所有资产（Pixels、账户、粉丝页、Catalog）
 */
export const syncFacebookUserAssets = async (fbUserId: string, accessToken: string, tokenId?: string) => {
  logger.info(`[FacebookUser] Starting sync for user ${fbUserId}`)
  
  try {
    // 更新同步状态
    await FacebookUser.findOneAndUpdate(
      { fbUserId },
      { 
        fbUserId,
        tokenId,
        syncStatus: 'syncing',
        $unset: { syncError: 1 }
      },
      { upsert: true, new: true }
    )
    
    // 1. 获取所有广告账户
    const accounts = await fetchAdAccounts(accessToken)
    logger.info(`[FacebookUser] Found ${accounts.length} ad accounts`)
    
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
      }
    }
    
    // 3. 获取所有粉丝页
    const pagesMap = new Map<string, any>()
    
    for (const account of accounts) {
      const accountId = account.account_id || account.id?.replace('act_', '')
      try {
        const pages = await fetchAccountPages(accountId, accessToken)
        for (const page of pages) {
          if (!pagesMap.has(page.id)) {
            pagesMap.set(page.id, {
              pageId: page.id,
              name: page.name,
              accessToken: page.access_token,
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
        }
      }
      logger.info(`[FacebookUser] Found ${catalogsMap.size} catalogs across ${businesses.length} businesses`)
    } catch (e: any) {
      // 如果缺少权限，这里通常会报错，直接降级不阻塞主流程
      logger.warn(`[FacebookUser] Failed to fetch catalogs (optional): ${e?.message || e}`)
    }

    // 4. 保存到数据库
    const result = await FacebookUser.findOneAndUpdate(
      { fbUserId },
      {
        fbUserId,
        tokenId,
        pixels: Array.from(pixelMap.values()),
        adAccounts: accounts.map(acc => ({
          accountId: acc.account_id || acc.id?.replace('act_', ''),
          name: acc.name,
          status: acc.account_status,
          currency: acc.currency,
          timezone: acc.timezone_name,
        })),
        pages: Array.from(pagesMap.values()),
        productCatalogs: Array.from(catalogsMap.values()),
        lastSyncedAt: new Date(),
        syncStatus: 'completed',
      },
      { upsert: true, new: true }
    )
    
    logger.info(`[FacebookUser] Sync completed for ${fbUserId}: ${pixelMap.size} pixels, ${accounts.length} accounts, ${pagesMap.size} pages, ${catalogsMap.size} catalogs`)
    
    return result
  } catch (error: any) {
    logger.error(`[FacebookUser] Sync failed for ${fbUserId}:`, error)
    
    await FacebookUser.findOneAndUpdate(
      { fbUserId },
      { 
        syncStatus: 'failed',
        syncError: error.message,
      }
    )
    
    throw error
  }
}

/**
 * 获取缓存的 Pixels
 */
export const getCachedPixels = async (fbUserId: string) => {
  const user = await FacebookUser.findOne({ fbUserId })
  return user?.pixels || []
}

/**
 * 获取缓存的账户
 */
export const getCachedAccounts = async (fbUserId: string) => {
  const user = await FacebookUser.findOne({ fbUserId })
  return user?.adAccounts || []
}

/**
 * 获取缓存的粉丝页
 */
export const getCachedPages = async (fbUserId: string, accountId?: string) => {
  const user = await FacebookUser.findOne({ fbUserId })
  if (!user?.pages) return []
  
  if (accountId) {
    // 筛选该账户可用的粉丝页
    return user.pages.filter((p: any) => 
      p.accounts?.some((a: any) => a.accountId === accountId)
    )
  }
  
  return user.pages
}

/**
 * 获取缓存的 Catalogs
 */
export const getCachedCatalogs = async (fbUserId: string) => {
  const user = await FacebookUser.findOne({ fbUserId })
  return user?.productCatalogs || []
}

/**
 * 获取同步状态
 */
export const getSyncStatus = async (fbUserId: string) => {
  const user = await FacebookUser.findOne({ fbUserId })
  return {
    status: user?.syncStatus || 'pending',
    lastSyncedAt: user?.lastSyncedAt,
    error: user?.syncError,
    pixelCount: user?.pixels?.length || 0,
    accountCount: user?.adAccounts?.length || 0,
    pageCount: user?.pages?.length || 0,
    catalogCount: user?.productCatalogs?.length || 0,
  }
}

// ============ Helper Functions ============

async function fetchAdAccounts(accessToken: string): Promise<any[]> {
  const url = `${FB_BASE_URL}/me/adaccounts?fields=id,account_id,name,account_status,currency,timezone_name&limit=100&access_token=${accessToken}`
  const response = await fetch(url)
  const data = await response.json()
  
  if (data.error) {
    throw new Error(data.error.message)
  }
  
  return data.data || []
}

async function fetchAccountPixels(accountId: string, accessToken: string): Promise<any[]> {
  const url = `${FB_BASE_URL}/act_${accountId}/adspixels?fields=id,name&access_token=${accessToken}`
  const response = await fetch(url)
  const data = await response.json()
  
  if (data.error) {
    throw new Error(data.error.message)
  }
  
  return data.data || []
}

async function fetchAccountPages(accountId: string, accessToken: string): Promise<any[]> {
  const url = `${FB_BASE_URL}/act_${accountId}/promote_pages?fields=id,name,access_token&access_token=${accessToken}`
  const response = await fetch(url)
  const data = await response.json()
  
  if (data.error) {
    throw new Error(data.error.message)
  }
  
  return data.data || []
}

async function fetchBusinesses(accessToken: string): Promise<any[]> {
  const url = `${FB_BASE_URL}/me/businesses?fields=id,name&limit=100&access_token=${accessToken}`
  const response = await fetch(url)
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return data.data || []
}

async function fetchBusinessCatalogs(businessId: string, accessToken: string): Promise<any[]> {
  // owned_product_catalogs 需要 catalog_management；拿不到就会报权限错误
  const url = `${FB_BASE_URL}/${businessId}/owned_product_catalogs?fields=id,name&limit=200&access_token=${accessToken}`
  const response = await fetch(url)
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return data.data || []
}

export default {
  syncFacebookUserAssets,
  getCachedPixels,
  getCachedAccounts,
  getCachedPages,
  getCachedCatalogs,
  getSyncStatus,
}

