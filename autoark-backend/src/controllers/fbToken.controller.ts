import { Request, Response, NextFunction } from 'express'
import FbToken, { IFbToken } from '../models/FbToken'
import {
  validateToken,
  checkAndUpdateTokenStatus,
} from '../services/fbToken.validation.service'
import logger from '../utils/logger'
import { UserRole } from '../models/User'

/**
 * 获取 Token 过滤条件
 * - 超级管理员：看所有
 * - 组织管理员：看本组织 + 公共数据
 * - 普通成员：看自己绑定的 + 公共数据
 */
const getTokenFilter = (req: Request): any => {
  if (!req.user) return { _id: null } // 未认证，返回空结果
  
  // 超级管理员看所有
  if (req.user.role === UserRole.SUPER_ADMIN) return {}
  
  // 组织管理员看本组织 + 公共数据（无 userId 或 userId 为空）
  if (req.user.role === UserRole.ORG_ADMIN && req.user.organizationId) {
    return {
      $or: [
        { organizationId: req.user.organizationId },
        { userId: { $exists: false } },
        { userId: null },
        { userId: '' },
        { userId: 'default-user' } // 兼容旧数据
      ]
    }
  }
  
  // 普通成员看自己绑定的 + 公共数据（无 userId 或 userId 为空）
  return {
    $or: [
      { userId: req.user.userId },
      { userId: { $exists: false } },
      { userId: null },
      { userId: '' },
      { userId: 'default-user' } // 兼容旧数据
    ]
  }
}

/**
 * 绑定/保存 Facebook token
 * POST /api/fb-token
 * Body: { token: string, optimizer?: string }
 */
export const bindToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { token, optimizer } = req.body
    // 使用当前登录用户的 ID
    const userId = req.user?.userId || 'default-user'

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      })
    }

    // 验证 token
    logger.info(`[Token Bind] Validating token for user: ${userId}`)
    const validation = await validateToken(token)

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: `Invalid Facebook token: ${validation.error || 'Unknown error'}`,
      })
    }

    // 保存或更新 token
    // 使用 fbUserId 作为唯一标识，因为每个 Facebook 用户应该只有一个 token
    const fbUserId = validation.fbUser?.id
    if (!fbUserId) {
      return res.status(400).json({
        success: false,
        message: 'Failed to get Facebook user ID from token',
      })
    }

    const tokenData: any = {
      userId,
      organizationId: req.user?.organizationId, // 组织隔离
      token,
      status: 'active',
      lastCheckedAt: new Date(),
      fbUserId: fbUserId,
      fbUserName: validation.fbUser?.name,
    }

    if (optimizer) {
      tokenData.optimizer = optimizer
    }

    if (validation.expiresAt) {
      tokenData.expiresAt = validation.expiresAt
    }

    // 使用 fbUserId 作为唯一标识，而不是 userId
    // 这样同一个 Facebook 用户只能有一个 token，但不同的 Facebook 用户可以有多个 token
    const savedToken = await FbToken.findOneAndUpdate(
      { fbUserId: fbUserId },
      tokenData,
      { new: true, upsert: true },
    )

    logger.info(`[Token Bind] Token saved successfully for user: ${userId}`)

    return res.json({
      success: true,
      message: 'Facebook token saved successfully',
      data: {
        id: savedToken._id,
        userId: savedToken.userId,
        optimizer: savedToken.optimizer,
        status: savedToken.status,
        fbUserId: savedToken.fbUserId,
        fbUserName: savedToken.fbUserName,
        expiresAt: savedToken.expiresAt,
        lastCheckedAt: savedToken.lastCheckedAt,
      },
    })
  } catch (error: any) {
    logger.error('[Token Bind] Error:', error)
    next(error)
  }
}

/**
 * 获取 token 列表（支持筛选）
 * GET /api/fb-token?optimizer=xxx&startDate=xxx&endDate=xxx&status=xxx
 */
export const getTokens = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { optimizer, startDate, endDate, status } = req.query

    // 构建查询条件 - 根据用户角色过滤
    const query: any = { ...getTokenFilter(req) }

    if (optimizer) {
      query.optimizer = optimizer as string
    }

    if (status) {
      query.status = status as string
    }

    if (startDate || endDate) {
      query.createdAt = {}
      if (startDate) {
        query.createdAt.$gte = new Date(startDate as string)
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate as string)
      }
    }

    // 查询 tokens
    const tokens = await FbToken.find(query)
      .sort({ createdAt: -1 })
      .lean()

    // 移除敏感信息（token）
    const safeTokens = tokens.map((token: any) => ({
      id: token._id,
      userId: token.userId,
      optimizer: token.optimizer,
      status: token.status,
      fbUserId: token.fbUserId,
      fbUserName: token.fbUserName,
      expiresAt: token.expiresAt,
      lastCheckedAt: token.lastCheckedAt,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      // 不返回 token 本身（安全考虑）
    }))

    return res.json({
      success: true,
      data: safeTokens,
      count: safeTokens.length,
    })
  } catch (error: any) {
    logger.error('[Token Get] Error:', error)
    next(error)
  }
}

/**
 * 获取单个 token 详情
 * GET /api/fb-token/:id
 */
export const getTokenById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const token = await FbToken.findById(id).lean()

    if (!token) {
      return res.status(404).json({
        success: false,
        message: 'Token not found',
      })
    }

    // 返回 token 信息（但不返回 token 本身）
    return res.json({
      success: true,
      data: {
        id: token._id,
        userId: token.userId,
        optimizer: token.optimizer,
        status: token.status,
        fbUserId: token.fbUserId,
        fbUserName: token.fbUserName,
        expiresAt: token.expiresAt,
        lastCheckedAt: token.lastCheckedAt,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
      },
    })
  } catch (error: any) {
    logger.error('[Token GetById] Error:', error)
    next(error)
  }
}

/**
 * 手动检查 token 状态
 * POST /api/fb-token/:id/check
 */
export const checkTokenStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const token = await FbToken.findById(id)

    if (!token) {
      return res.status(404).json({
        success: false,
        message: 'Token not found',
      })
    }

    // 检查 token 状态
    const newStatus = await checkAndUpdateTokenStatus(token)

    // 重新获取更新后的 token
    const updatedToken = await FbToken.findById(id).lean()

    return res.json({
      success: true,
      message: 'Token status checked',
      data: {
        id: updatedToken?._id,
        status: newStatus,
        lastCheckedAt: updatedToken?.lastCheckedAt,
        expiresAt: updatedToken?.expiresAt,
      },
    })
  } catch (error: any) {
    logger.error('[Token Check] Error:', error)
    next(error)
  }
}

/**
 * 更新 token（如更新优化师）
 * PUT /api/fb-token/:id
 * Body: { optimizer?: string }
 */
export const updateToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const { optimizer } = req.body

    const updateData: any = {
      updatedAt: new Date(),
    }

    if (optimizer !== undefined) {
      updateData.optimizer = optimizer
    }

    const updatedToken = await FbToken.findByIdAndUpdate(id, updateData, {
      new: true,
    }).lean()

    if (!updatedToken) {
      return res.status(404).json({
        success: false,
        message: 'Token not found',
      })
    }

    return res.json({
      success: true,
      message: 'Token updated successfully',
      data: {
        id: updatedToken._id,
        userId: updatedToken.userId,
        optimizer: updatedToken.optimizer,
        status: updatedToken.status,
        fbUserId: updatedToken.fbUserId,
        fbUserName: updatedToken.fbUserName,
        expiresAt: updatedToken.expiresAt,
        lastCheckedAt: updatedToken.lastCheckedAt,
        createdAt: updatedToken.createdAt,
        updatedAt: updatedToken.updatedAt,
      },
    })
  } catch (error: any) {
    logger.error('[Token Update] Error:', error)
    next(error)
  }
}

/**
 * 删除 token
 * DELETE /api/fb-token/:id
 */
export const deleteToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const token = await FbToken.findByIdAndDelete(id)

    if (!token) {
      return res.status(404).json({
        success: false,
        message: 'Token not found',
      })
    }

    return res.json({
      success: true,
      message: 'Token deleted successfully',
    })
  } catch (error: any) {
    logger.error('[Token Delete] Error:', error)
    next(error)
  }
}

