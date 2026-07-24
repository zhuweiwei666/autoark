import logger from '../utils/logger'
import FbToken from '../models/FbToken'
import FacebookUser from '../models/FacebookUser'
import { tokenPool } from './facebook.token.pool'
import { syncFacebookTokenAssets } from './facebookUser.service'
import {
  getPixelDetails as getPixelDetailsApi,
  getPixelEvents as getPixelEventsApi,
} from '../integration/facebook/pixels.api'

/**
 * Facebook Pixel 服务
 * Pixel 列表读取授权后的资产快照；详情和事件按需实时查询。
 */

export interface PixelInfo {
  id: string
  name: string
  owner_business?: {
    id: string
    name: string
  }
  is_created_by_business?: boolean
  creation_time?: string
  last_fired_time?: string
  data_use_setting?: string
  enable_automatic_matching?: boolean
  pixel_id?: string
  code?: string
  raw?: any
  tokenId?: string
  fbUserId?: string
  fbUserName?: string
}

export interface PixelEvent {
  event_name: string
  event_time: number
  event_id?: string
  user_data?: any
  custom_data?: any
  raw?: any
}

export interface PixelInventoryMeta {
  source: 'cache'
  tokenId?: string
  tokenCount?: number
  syncStatus?: string
  lastSyncedAt?: Date | string
  accountCount: number
  pixelCount: number
  pageCount: number
  catalogCount: number
  syncStats?: {
    graphRequestCount?: number
    graphFailureCount?: number
    skippedInactiveAccountCount?: number
    accountAssetMode?: string
    businessAssetMode?: string
  }
}

export interface PixelInventoryResult {
  pixels: PixelInfo[]
  meta: PixelInventoryMeta
}

const toIdString = (value: any) => String(value || '')
const toPlainSnapshot = (value: any) => value?.toObject?.() || value

const toCachedPixel = (pixel: any, token: any): PixelInfo => ({
  id: pixel.pixelId || pixel.id,
  pixel_id: pixel.pixelId || pixel.id,
  name: pixel.name || 'Unnamed Pixel',
  owner_business: pixel.ownerBusiness || pixel.owner_business,
  is_created_by_business:
    pixel.isCreatedByBusiness ?? pixel.is_created_by_business,
  creation_time: pixel.creationTime || pixel.creation_time,
  last_fired_time: pixel.lastFiredTime || pixel.last_fired_time,
  data_use_setting: pixel.dataUseSetting || pixel.data_use_setting,
  enable_automatic_matching:
    pixel.enableAutomaticMatching ?? pixel.enable_automatic_matching,
  tokenId: toIdString(token._id),
  fbUserId: token.fbUserId,
  fbUserName: token.fbUserName,
})

const inventoryMeta = (
  snapshot: any,
  overrides: Partial<PixelInventoryMeta> = {},
): PixelInventoryMeta => ({
  source: 'cache',
  syncStatus: snapshot?.syncStatus || 'pending',
  lastSyncedAt: snapshot?.lastSyncedAt,
  accountCount: snapshot?.adAccounts?.length || 0,
  pixelCount: snapshot?.pixels?.length || 0,
  pageCount: snapshot?.pages?.length || 0,
  catalogCount: snapshot?.productCatalogs?.length || 0,
  syncStats: snapshot?.syncStats,
  ...overrides,
})

/**
 * 默认展示最近授权的活跃 token，避免随机 token 和实时 Meta 请求造成结果漂移。
 */
export const getAllPixels = async (): Promise<PixelInventoryResult> => {
  try {
    const tokenDoc = await FbToken.findOne({ status: 'active' })
      .sort({ createdAt: -1 })
      .lean()
    if (!tokenDoc) {
      throw new Error('No active Facebook token available')
    }
    return getPixelsByToken(toIdString(tokenDoc._id))
  } catch (error: any) {
    logger.error('[Pixels] Failed to read pixels:', error)
    throw error
  }
}

/**
 * 获取指定 Token 的缓存 Pixels。仅显式 refresh 时强制调用 Meta。
 */
export const getPixelsByToken = async (
  tokenId: string,
  options: { refresh?: boolean } = {},
): Promise<PixelInventoryResult> => {
  try {
    const tokenDoc = await FbToken.findById(tokenId)
    if (!tokenDoc) {
      throw new Error(`Token ${tokenId} not found`)
    }
    if (tokenDoc.status && tokenDoc.status !== 'active') {
      throw new Error(`Token ${tokenId} is not active`)
    }

    let snapshot: any
    if (options.refresh) {
      snapshot = toPlainSnapshot(
        await syncFacebookTokenAssets(tokenDoc as any, { force: true }),
      )
    } else {
      snapshot = await FacebookUser.findOne({ tokenId: tokenDoc._id }).lean()
    }

    const pixels = (snapshot?.pixels || []).map((pixel: any) =>
      toCachedPixel(pixel, tokenDoc),
    )
    logger.info(`[Pixels] Read ${pixels.length} cached pixels for token ${tokenId}`)
    return {
      pixels,
      meta: inventoryMeta(snapshot, { tokenId }),
    }
  } catch (error: any) {
    logger.error(`[Pixels] Failed to read pixels for token ${tokenId}:`, error)
    throw error
  }
}

/**
 * 获取 Pixel 详情（包括代码）。这是用户明确点开的单资产实时请求。
 */
export const getPixelDetails = async (
  pixelId: string,
  tokenId?: string,
): Promise<PixelInfo & { code?: string }> => {
  try {
    let token: string | undefined

    if (tokenId) {
      const tokenDoc = await FbToken.findById(tokenId)
      if (!tokenDoc) {
        throw new Error(`Token ${tokenId} not found`)
      }
      token = tokenDoc.token
    } else {
      token = tokenPool.getNextToken()
      if (!token) {
        throw new Error('No available token in token pool')
      }
    }

    logger.info(`[Pixels] Fetching details for pixel ${pixelId}`)
    return getPixelDetailsApi(pixelId, token)
  } catch (error: any) {
    logger.error(`[Pixels] Failed to fetch pixel details for ${pixelId}:`, error)
    throw error
  }
}

/**
 * 获取 Pixel 事件（最近的事件）。这是用户明确点开的单资产实时请求。
 */
export const getPixelEvents = async (
  pixelId: string,
  tokenId?: string,
  limit: number = 100,
): Promise<PixelEvent[]> => {
  try {
    let token: string | undefined

    if (tokenId) {
      const tokenDoc = await FbToken.findById(tokenId)
      if (!tokenDoc) {
        throw new Error(`Token ${tokenId} not found`)
      }
      token = tokenDoc.token
    } else {
      token = tokenPool.getNextToken()
      if (!token) {
        throw new Error('No available token in token pool')
      }
    }

    logger.info(`[Pixels] Fetching events for pixel ${pixelId}`)
    const events = await getPixelEventsApi(pixelId, token, limit)
    logger.info(`[Pixels] Fetched ${events.length} events for pixel ${pixelId}`)
    return events
  } catch (error: any) {
    logger.error(`[Pixels] Failed to fetch events for ${pixelId}:`, error)
    throw error
  }
}

/**
 * 一次数据库查询聚合所有活跃 token 的快照，不做逐 token Meta 请求。
 */
export const getAllPixelsFromAllTokens = async (): Promise<PixelInventoryResult> => {
  try {
    const tokens = await FbToken.find({ status: 'active' })
      .select('_id fbUserId fbUserName')
      .lean()
    const tokenIds = tokens.map(token => token._id)
    const snapshots = tokenIds.length
      ? await FacebookUser.find({ tokenId: { $in: tokenIds } }).lean()
      : []
    const tokenById = new Map(tokens.map(token => [toIdString(token._id), token]))
    const pixels: PixelInfo[] = []
    let accountCount = 0
    let pageCount = 0
    let catalogCount = 0

    for (const snapshot of snapshots) {
      const token = tokenById.get(toIdString(snapshot.tokenId))
      if (!token) continue
      accountCount += snapshot.adAccounts?.length || 0
      pageCount += snapshot.pages?.length || 0
      catalogCount += snapshot.productCatalogs?.length || 0
      for (const pixel of snapshot.pixels || []) {
        pixels.push(toCachedPixel(pixel, token))
      }
    }

    logger.info(`[Pixels] Read ${pixels.length} cached pixels from ${tokens.length} tokens`)
    return {
      pixels,
      meta: {
        source: 'cache',
        tokenCount: tokens.length,
        accountCount,
        pixelCount: pixels.length,
        pageCount,
        catalogCount,
      },
    }
  } catch (error: any) {
    logger.error('[Pixels] Failed to read pixels from all tokens:', error)
    throw error
  }
}
