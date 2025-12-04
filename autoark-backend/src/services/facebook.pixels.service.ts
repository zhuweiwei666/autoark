import logger from '../utils/logger'
import FbToken from '../models/FbToken'
import { tokenPool } from './facebook.token.pool'
import { getPixels as getPixelsApi, getPixelDetails as getPixelDetailsApi, getPixelEvents as getPixelEventsApi } from '../integration/facebook/pixels.api'

/**
 * Facebook Pixel 服务
 * 通过登录的 Facebook 个人号抓取像素权限信息
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
}

export interface PixelEvent {
  event_name: string
  event_time: number
  event_id?: string
  user_data?: any
  custom_data?: any
  raw?: any
}

/**
 * 获取所有 Pixels（通过 Token Pool 自动选择 token）
 */
export const getAllPixels = async (): Promise<PixelInfo[]> => {
  try {
    // 使用 Token Pool 获取 token
    let token = tokenPool.getNextToken()
    
    // 如果 Token Pool 没有可用 token，尝试从数据库获取第一个活跃的 token
    if (!token) {
      logger.warn('[Pixels] No token from token pool, trying to get from database')
      const tokenDoc = await FbToken.findOne({ status: 'active' }).sort({ createdAt: 1 }).lean()
      if (tokenDoc) {
        token = tokenDoc.token
        logger.info('[Pixels] Using token from database as fallback')
      } else {
        throw new Error('No available token in token pool or database')
      }
    }

    logger.info('[Pixels] Fetching pixels using token pool')

    // 使用集成层的 API
    const pixels = await getPixelsApi(token)

    logger.info(`[Pixels] Fetched ${pixels.length} pixels`)
    return pixels
  } catch (error: any) {
    logger.error('[Pixels] Failed to fetch pixels:', error)
    throw error
  }
}

/**
 * 获取指定 Token 的 Pixels
 */
export const getPixelsByToken = async (tokenId: string): Promise<PixelInfo[]> => {
  try {
    const tokenDoc = await FbToken.findById(tokenId)
    if (!tokenDoc) {
      throw new Error(`Token ${tokenId} not found`)
    }

    logger.info(`[Pixels] Fetching pixels for token ${tokenId}`)

    // 使用集成层的 API
    const pixels = await getPixelsApi(tokenDoc.token)

    logger.info(`[Pixels] Fetched ${pixels.length} pixels for token ${tokenId}`)
    return pixels
  } catch (error: any) {
    logger.error(`[Pixels] Failed to fetch pixels for token ${tokenId}:`, error)
    throw error
  }
}

/**
 * 获取 Pixel 详情（包括代码）
 */
export const getPixelDetails = async (
  pixelId: string,
  tokenId?: string
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

    // 使用集成层的 API
    const pixel = await getPixelDetailsApi(pixelId, token)

    return pixel
  } catch (error: any) {
    logger.error(`[Pixels] Failed to fetch pixel details for ${pixelId}:`, error)
    throw error
  }
}

/**
 * 获取 Pixel 事件（最近的事件）
 */
export const getPixelEvents = async (
  pixelId: string,
  tokenId?: string,
  limit: number = 100
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

    // 使用集成层的 API
    const events = await getPixelEventsApi(pixelId, token, limit)

    logger.info(`[Pixels] Fetched ${events.length} events for pixel ${pixelId}`)
    return events
  } catch (error: any) {
    logger.error(`[Pixels] Failed to fetch events for pixel ${pixelId}:`, error)
    throw error
  }
}

/**
 * 获取所有 Token 的 Pixels（汇总）
 */
export const getAllPixelsFromAllTokens = async (): Promise<
  Array<PixelInfo & { tokenId: string; fbUserId?: string; fbUserName?: string }>
> => {
  try {
    const tokens = await FbToken.find({ status: 'active' }).lean()
    const allPixels: Array<PixelInfo & { tokenId: string; fbUserId?: string; fbUserName?: string }> = []

    for (const token of tokens) {
      try {
        const pixels = await getPixelsByToken(token._id.toString())
        for (const pixel of pixels) {
          allPixels.push({
            ...pixel,
            tokenId: token._id.toString(),
            fbUserId: token.fbUserId,
            fbUserName: token.fbUserName,
          })
        }
      } catch (error: any) {
        logger.warn(`[Pixels] Failed to fetch pixels for token ${token._id}:`, error)
        // 继续处理其他 token
      }
    }

    logger.info(`[Pixels] Fetched ${allPixels.length} pixels from ${tokens.length} tokens`)
    return allPixels
  } catch (error: any) {
    logger.error('[Pixels] Failed to fetch pixels from all tokens:', error)
    throw error
  }
}

