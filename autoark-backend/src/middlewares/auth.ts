import { Request, Response, NextFunction } from 'express'
import { verifyToken, JwtPayload } from '../utils/jwt'
import { UserRole } from '../models/User'
import User from '../models/User'

// 扩展 Express Request 类型，添加 user 属性
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

/**
 * 认证中间件 - 验证用户是否登录
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 从 header 中获取 token
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: '未提供认证令牌',
      })
      return
    }

    const token = authHeader.substring(7) // 移除 'Bearer ' 前缀

    // 验证 token
    const decoded = verifyToken(token)

    // 检查用户是否仍然存在且状态为 active
    const user = await User.findById(decoded.userId)
    if (!user || user.status !== 'active') {
      res.status(401).json({
        success: false,
        message: '用户不存在或已被禁用',
      })
      return
    }

    // 将解码后的用户信息附加到请求对象
    req.user = decoded

    next()
  } catch (error: any) {
    res.status(401).json({
      success: false,
      message: error.message || '认证失败',
    })
  }
}

/**
 * 权限检查中间件 - 检查用户是否有指定角色
 */
export const authorize = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: '未认证',
      })
      return
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: '权限不足',
      })
      return
    }

    next()
  }
}

/**
 * 数据隔离中间件 - 确保用户只能访问自己组织的数据
 * 超级管理员可以访问所有数据
 */
export const dataIsolation = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: '未认证',
    })
    return
  }

  // 超级管理员可以访问所有数据
  if (req.user.role === UserRole.SUPER_ADMIN) {
    next()
    return
  }

  // 其他用户只能访问自己组织的数据
  if (!req.user.organizationId) {
    res.status(403).json({
      success: false,
      message: '用户未关联组织',
    })
    return
  }

  next()
}

/**
 * 可选认证中间件 - 如果有 token 则验证，没有则继续
 * 用于某些公开但登录后有额外功能的接口
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      const decoded = verifyToken(token)
      req.user = decoded
    }
    next()
  } catch (error) {
    // 忽略错误，继续执行
    next()
  }
}
