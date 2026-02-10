import { log } from '../logger'

/**
 * Facebook Token Pool - 多 Token 轮换、限流降级
 * initialize() 时传入 token 列表，不直接依赖数据库模型
 */

interface PoolToken {
  id: string
  token: string
  priority: number
  lastUsedAt: Date
  failureCount: number
  rateLimitUntil?: Date
  status: 'active' | 'rate_limited' | 'failed'
}

class TokenPool {
  private tokens: PoolToken[] = []

  load(tokenList: Array<{ id: string; token: string }>) {
    this.tokens = tokenList.map((t, i) => ({
      ...t,
      priority: i,
      lastUsedAt: new Date(0),
      failureCount: 0,
      status: 'active' as const,
    }))
    log.info(`[TokenPool] Loaded ${this.tokens.length} tokens`)
  }

  getNextToken(): string | null {
    if (this.tokens.length === 0) return null
    const available = this.tokens.filter(
      (t) => t.status === 'active' && (!t.rateLimitUntil || t.rateLimitUntil < new Date())
    )
    if (available.length === 0) {
      const sorted = [...this.tokens].sort((a, b) => a.priority - b.priority)
      return sorted[0]?.token || null
    }
    available.sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : a.lastUsedAt.getTime() - b.lastUsedAt.getTime())
    const selected = available[0]
    selected.lastUsedAt = new Date()
    return selected.token
  }

  markTokenFailure(token: string, error: any) {
    const t = this.tokens.find((x) => x.token === token)
    if (!t) return
    t.failureCount++
    const msg = error?.response?.data?.error?.message || error?.message || ''
    if (msg.includes('rate limit') || msg.includes('request limit') || msg.includes('#4') || msg.includes('#17')) {
      t.rateLimitUntil = new Date(Date.now() + 5 * 60 * 1000)
      t.status = 'rate_limited'
    } else if (t.failureCount >= 3) {
      t.status = 'failed'
    }
  }

  markTokenSuccess(token: string) {
    const t = this.tokens.find((x) => x.token === token)
    if (!t) return
    t.failureCount = 0
    t.status = 'active'
    if (t.rateLimitUntil && t.rateLimitUntil < new Date()) t.rateLimitUntil = undefined
  }
}

export const tokenPool = new TokenPool()
