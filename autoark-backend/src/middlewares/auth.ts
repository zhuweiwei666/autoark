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
 * 获取组织过滤条件
 * - 超级管理员：返回空对象（可查看所有）
 * - 其他用户：返回 { organizationId: xxx }
 */
export const getOrgFilter = (req: Request): { organizationId?: any } => {
  if (!req.user) return {}
  if (req.user.role === UserRole.SUPER_ADMIN) return {}
  return req.user.organizationId ? { organizationId: req.user.organizationId } : {}
}

/**
 * 获取用户关联的账户 ID 列表
 * 用于过滤 Facebook 数据（Dashboard、广告系列等）
 * 
 * 逻辑：
 * - 超级管理员：返回 null（表示不限制）
 * - 其他用户：返回该用户绑定的 Token 关联的所有账户 ID
 */
export const getUserAccountIds = async (req: Request): Promise<string[] | null> => {
  if (!req.user) return []
  
  // 超级管理员看所有
  if (req.user.role === UserRole.SUPER_ADMIN) return null
  
  // 查找用户绑定的 Token
  const FbToken = require('../models/FbToken').default
  const Account = require('../models/Account').default
  
  let tokenQuery: any = { status: 'active' }
  
  if (req.user.role === UserRole.ORG_ADMIN && req.user.organizationId) {
    // 组织管理员：看本组织所有 Token 关联的账户
    tokenQuery.organizationId = req.user.organizationId
  } else {
    // 普通用户：只看自己绑定的 Token 关联的账户
    tokenQuery.userId = req.user.userId
  }
  
  // 旧实现依赖 Account.fbUserId 字段，但当前 Account 模型并未保证该字段存在。
  // 为了与现有数据结构兼容，这里改为通过 Account.token（同步账户时已写入）进行关联。
  const tokens = await FbToken.find(tokenQuery).select('token').lean()
  if (!tokens || tokens.length === 0) return []
  
  const tokenValues = tokens.map((t: any) => t.token).filter(Boolean)
  if (tokenValues.length === 0) return []
  
  const accounts = await Account.find({ token: { $in: tokenValues } }).select('accountId').lean()
  const accountIds = accounts.map((a: any) => a.accountId).filter(Boolean)
  // 去重
  return Array.from(new Set(accountIds))
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
