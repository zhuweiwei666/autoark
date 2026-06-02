import { Request, Response, NextFunction } from 'express'
import * as pixelsService from '../services/facebook.pixels.service'
import { UserRole } from '../models/User'
import { parseLimitedNumber } from '../utils/pagination'

const requireSuperAdmin = (req: Request, res: Response): boolean => {
  if (req.user?.role === UserRole.SUPER_ADMIN) return true
  res.status(403).json({ success: false, error: 'Forbidden' })
  return false
}

/**
 * 获取所有 Pixels
 */
export const getPixels = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const { tokenId, allTokens } = req.query

    let pixels: any[]

    if (allTokens === 'true') {
      // 获取所有 Token 的 Pixels
      pixels = await pixelsService.getAllPixelsFromAllTokens()
    } else if (tokenId) {
      // 获取指定 Token 的 Pixels
      pixels = await pixelsService.getPixelsByToken(tokenId as string)
    } else {
      // 使用 Token Pool 自动选择
      pixels = await pixelsService.getAllPixels()
    }

    res.json({
      success: true,
      data: pixels,
      count: pixels.length,
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
    const { id } = req.params
    const { tokenId } = req.query

    const pixel = await pixelsService.getPixelDetails(id, tokenId as string | undefined)

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
    const { id } = req.params
    const { tokenId, limit } = req.query

    const events = await pixelsService.getPixelEvents(
      id,
      tokenId as string | undefined,
      parseLimitedNumber(limit, 100, 200)
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
