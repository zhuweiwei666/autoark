import { Request, Response, NextFunction } from 'express'
import * as pixelsService from '../services/facebook.pixels.service'
import { UserRole } from '../models/User'
import { parseLimitedNumber, pickSafeQueryString } from '../utils/pagination'

const FACEBOOK_PIXEL_ID_MAX_LENGTH = 128
const FACEBOOK_TOKEN_ID_MAX_LENGTH = 80

const requireSuperAdmin = (req: Request, res: Response): boolean => {
  if (req.user?.role === UserRole.SUPER_ADMIN) return true
  res.status(403).json({ success: false, error: 'Forbidden' })
  return false
}

const pickPixelId = (value: any) => pickSafeQueryString(value, FACEBOOK_PIXEL_ID_MAX_LENGTH)
const pickTokenId = (value: any) => pickSafeQueryString(value, FACEBOOK_TOKEN_ID_MAX_LENGTH)

const rejectInvalidStringParam = (
  res: Response,
  name: string,
) => {
  res.status(400).json({
    success: false,
    error: `${name} must be a string`,
  })
}

const rejectInvalidBooleanParam = (
  res: Response,
  name: string,
) => {
  res.status(400).json({
    success: false,
    error: `${name} must be true or false`,
  })
}

const rejectUnexpectedQueryParam = (
  res: Response,
  key: string,
) => {
  res.status(400).json({
    success: false,
    error: `Unexpected query parameter: ${key}`,
  })
}

const rejectUnexpectedQueryKeys = (
  query: Request['query'],
  allowedKeys: readonly string[],
  res: Response,
): boolean => {
  const allowed = new Set(allowedKeys)
  const unexpectedKey = Object.keys(query).find(key => !allowed.has(key))
  if (!unexpectedKey) return false
  rejectUnexpectedQueryParam(res, unexpectedKey)
  return true
}

/**
 * 获取所有 Pixels
 */
export const getPixels = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    if (rejectUnexpectedQueryKeys(req.query, ['tokenId', 'allTokens', 'refresh'], res)) return

    const tokenId = pickTokenId(req.query.tokenId)

    if (req.query.tokenId !== undefined && !tokenId) {
      return rejectInvalidStringParam(res, 'tokenId')
    }
    if (
      req.query.allTokens !== undefined &&
      req.query.allTokens !== 'true' &&
      req.query.allTokens !== 'false'
    ) {
      return rejectInvalidBooleanParam(res, 'allTokens')
    }
    if (
      req.query.refresh !== undefined &&
      req.query.refresh !== 'true' &&
      req.query.refresh !== 'false'
    ) {
      return rejectInvalidBooleanParam(res, 'refresh')
    }
    const refresh = req.query.refresh === 'true'
    if (refresh && (!tokenId || req.query.allTokens === 'true')) {
      res.status(400).json({
        success: false,
        error: 'refresh=true requires one tokenId',
      })
      return
    }

    let result: pixelsService.PixelInventoryResult

    if (req.query.allTokens === 'true') {
      result = await pixelsService.getAllPixelsFromAllTokens()
    } else if (tokenId) {
      result = await pixelsService.getPixelsByToken(tokenId as string, { refresh })
    } else {
      result = await pixelsService.getAllPixels()
    }

    res.json({
      success: true,
      data: result.pixels,
      count: result.pixels.length,
      meta: result.meta,
    })
  } catch (error: any) {
    next(error)
  }
}

/**
 * 获取 Pixel 详情
 */
export const getPixelDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    if (rejectUnexpectedQueryKeys(req.query, ['tokenId'], res)) return

    const id = pickPixelId(req.params.id)
    const tokenId = pickTokenId(req.query.tokenId)

    if (!id) {
      return rejectInvalidStringParam(res, 'Pixel ID')
    }
    if (req.query.tokenId !== undefined && !tokenId) {
      return rejectInvalidStringParam(res, 'tokenId')
    }

    const pixel = await pixelsService.getPixelDetails(id, tokenId)

    res.json({
      success: true,
      data: pixel,
    })
  } catch (error: any) {
    next(error)
  }
}

/**
 * 获取 Pixel 事件
 */
export const getPixelEvents = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    if (rejectUnexpectedQueryKeys(req.query, ['tokenId', 'limit'], res)) return

    const id = pickPixelId(req.params.id)
    const tokenId = pickTokenId(req.query.tokenId)

    if (!id) {
      return rejectInvalidStringParam(res, 'Pixel ID')
    }
    if (req.query.tokenId !== undefined && !tokenId) {
      return rejectInvalidStringParam(res, 'tokenId')
    }

    const events = await pixelsService.getPixelEvents(
      id,
      tokenId,
      parseLimitedNumber(req.query.limit, 100, 200)
    )

    res.json({
      success: true,
      data: events,
      count: events.length,
    })
  } catch (error: any) {
    next(error)
  }
}
