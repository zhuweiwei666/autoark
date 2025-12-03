import FbToken from '../../models/FbToken'
import logger from '../../utils/logger'

/**
 * Token Pool 管理器
 * 支持多账号池、自动轮换、失败降级、限流切换
 */
class TokenPool {
  private tokens: Array<{
    id: string
    token: string
    fbUserId?: string
    optimizer?: string
    priority: number // 优先级，数字越小优先级越高
    lastUsedAt: Date
    failureCount: number // 失败次数
    rateLimitUntil?: Date // 限流直到这个时间
    status: 'active' | 'rate_limited' | 'failed' | 'disabled'
  }> = []

  private currentIndex = 0

  /**
   * 初始化 Token Pool
   */
  async initialize() {
    try {
      const tokenDocs = await FbToken.find({ status: 'active' })
        .sort({ createdAt: 1 }) // 按创建时间排序
        .lean()

      this.tokens = tokenDocs.map((doc, index) => ({
        id: doc._id.toString(),
        token: doc.token,
        fbUserId: doc.fbUserId,
        optimizer: doc.optimizer,
        priority: index, // 第一个 token 优先级最高
        lastUsedAt: new Date(0), // 从未使用
        failureCount: 0,
        status: 'active' as const,
      }))

      logger.info(`[TokenPool] Initialized with ${this.tokens.length} tokens`)
    } catch (error: any) {
      logger.error('[TokenPool] Failed to initialize:', error)
      throw error
    }
  }

  /**
   * 获取下一个可用的 Token（轮询策略）
   */
  getNextToken(): string | null {
    if (this.tokens.length === 0) {
      logger.warn('[TokenPool] No tokens available')
      return null
    }

    // 过滤出可用的 tokens（非限流、非失败、非禁用）
    const availableTokens = this.tokens.filter(
      (t) =>
        t.status === 'active' &&
        (!t.rateLimitUntil || t.rateLimitUntil < new Date())
    )

    if (availableTokens.length === 0) {
      logger.warn('[TokenPool] No available tokens, all are rate limited or failed')
      // 如果所有 token 都被限流，返回优先级最高的（即使被限流）
      const sorted = [...this.tokens].sort((a, b) => a.priority - b.priority)
      return sorted[0]?.token || null
    }

    // 按优先级和最后使用时间排序
    availableTokens.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }
      return a.lastUsedAt.getTime() - b.lastUsedAt.getTime()
    })

    const selectedToken = availableTokens[0]
    selectedToken.lastUsedAt = new Date()

    // 更新索引（用于轮询）
    this.currentIndex = (this.currentIndex + 1) % availableTokens.length

    return selectedToken.token
  }

  /**
   * 标记 Token 失败
   */
  markTokenFailure(token: string, error: any) {
    const tokenObj = this.tokens.find((t) => t.token === token)
    if (!tokenObj) return

    tokenObj.failureCount++
    const errorMessage = error?.response?.data?.error?.message || error?.message || ''

    // 检查是否是限流错误
    if (
      errorMessage.includes('rate limit') ||
      errorMessage.includes('request limit') ||
      errorMessage.includes('#4') ||
      errorMessage.includes('#17')
    ) {
      // 限流：设置限流时间（5分钟）
      tokenObj.rateLimitUntil = new Date(Date.now() + 5 * 60 * 1000)
      tokenObj.status = 'rate_limited'
      logger.warn(
        `[TokenPool] Token ${tokenObj.id} rate limited, will retry after ${tokenObj.rateLimitUntil.toISOString()}`
      )
    } else if (tokenObj.failureCount >= 3) {
      // 连续失败 3 次：标记为失败
      tokenObj.status = 'failed'
      logger.error(`[TokenPool] Token ${tokenObj.id} marked as failed after ${tokenObj.failureCount} failures`)
    }
  }

  /**
   * 标记 Token 成功（重置失败计数）
   */
  markTokenSuccess(token: string) {
    const tokenObj = this.tokens.find((t) => t.token === token)
    if (!tokenObj) return

    if (tokenObj.failureCount > 0) {
      tokenObj.failureCount = 0
      tokenObj.status = 'active'
      logger.info(`[TokenPool] Token ${tokenObj.id} recovered`)
    }

    // 清除限流标记（如果已过期）
    if (tokenObj.rateLimitUntil && tokenObj.rateLimitUntil < new Date()) {
      tokenObj.rateLimitUntil = undefined
      if (tokenObj.status === 'rate_limited') {
        tokenObj.status = 'active'
      }
    }
  }

  /**
   * 获取 Token 状态
   */
  getTokenStatus() {
    return this.tokens.map((t) => ({
      id: t.id,
      fbUserId: t.fbUserId,
      optimizer: t.optimizer,
      priority: t.priority,
      status: t.status,
      failureCount: t.failureCount,
      rateLimitUntil: t.rateLimitUntil,
      lastUsedAt: t.lastUsedAt,
    }))
  }

  /**
   * 手动切换 Token（用于测试或手动干预）
   */
  switchToToken(tokenId: string) {
    const tokenObj = this.tokens.find((t) => t.id === tokenId)
    if (!tokenObj) {
      throw new Error(`Token ${tokenId} not found`)
    }

    // 将选中的 token 优先级设为最高
    const currentPriority = tokenObj.priority
    this.tokens.forEach((t) => {
      if (t.priority < currentPriority) {
        t.priority++
      }
    })
    tokenObj.priority = 0

    logger.info(`[TokenPool] Switched to token ${tokenId}`)
  }
}

// 单例模式
export const tokenPool = new TokenPool()

