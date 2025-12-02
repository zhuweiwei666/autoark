import FbToken from '../models/FbToken'

/**
 * 获取 Facebook access token
 * @param options 选项
 * @param options.userId 用户 ID，默认为 'default-user'
 * @param options.optimizer 优化师名称，可选
 * @param options.status token 状态，默认为 'active'
 * @returns Facebook access token
 */
export const getFacebookAccessToken = async (options?: {
  userId?: string
  optimizer?: string
  status?: 'active' | 'expired' | 'invalid'
}) => {
  const userId = options?.userId || 'default-user'
  const status = options?.status || 'active'

  const query: any = { userId, status }

  if (options?.optimizer) {
    query.optimizer = options.optimizer
  }

  const saved = await FbToken.findOne(query).sort({ createdAt: -1 }) // 获取最新的

  if (!saved) {
    const errorMsg = options?.optimizer
      ? `Facebook token not found for optimizer: ${options.optimizer}. Please set it in Settings.`
      : 'Facebook token not found. Please set it in Settings.'
    throw new Error(errorMsg)
  }

  return saved.token
}

/**
 * 获取所有有效的 token（支持筛选）
 * @param options 选项
 * @returns token 数组
 */
export const getAllFacebookTokens = async (options?: {
  userId?: string
  optimizer?: string
  status?: 'active' | 'expired' | 'invalid'
}) => {
  const userId = options?.userId || 'default-user'
  const status = options?.status || 'active'

  const query: any = { userId, status }

  if (options?.optimizer) {
    query.optimizer = options.optimizer
  }

  const tokens = await FbToken.find(query).sort({ createdAt: -1 })

  return tokens.map((token) => ({
    id: token._id,
    token: token.token,
    optimizer: token.optimizer,
    status: token.status,
    fbUserId: token.fbUserId,
    fbUserName: token.fbUserName,
    expiresAt: token.expiresAt,
    lastCheckedAt: token.lastCheckedAt,
  }))
}
