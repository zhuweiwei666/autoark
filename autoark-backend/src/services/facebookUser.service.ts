import FacebookUser from '../models/FacebookUser'
import logger from '../utils/logger'

const FB_API_VERSION = 'v21.0'
const FB_BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`

/**
 * 同步 Facebook 用户的所有资产（Pixels、账户、粉丝页）
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
        lastSyncedAt: new Date(),
        syncStatus: 'completed',
      },
      { upsert: true, new: true }
    )
    
    logger.info(`[FacebookUser] Sync completed for ${fbUserId}: ${pixelMap.size} pixels, ${accounts.length} accounts, ${pagesMap.size} pages`)
    
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

export default {
  syncFacebookUserAssets,
  getCachedPixels,
  getCachedAccounts,
  getCachedPages,
  getSyncStatus,
}

