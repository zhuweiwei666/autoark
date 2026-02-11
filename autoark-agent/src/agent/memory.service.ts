/**
 * 记忆层 - Agent 的大脑存储
 * 三层架构：工作记忆(Redis) + 短期记忆(MongoDB 7天) + 长期记忆(MongoDB 永久)
 */
import { getRedis } from '../config/redis'
import { log } from '../platform/logger'
import mongoose from 'mongoose'

// ==================== 短期记忆模型 (7天自动清理) ====================

const shortTermSchema = new mongoose.Schema({
  category: { type: String, required: true, index: true }, // 'decision' | 'task' | 'user_pref' | 'observation'
  key: { type: String, required: true },
  content: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, index: { expires: 0 } }, // TTL 索引自动清理
}, { timestamps: true })

shortTermSchema.index({ category: 1, key: 1 })
const ShortTermMemory = mongoose.model('AgentShortMemory', shortTermSchema)

// ==================== 长期记忆模型 (永久) ====================

const longTermSchema = new mongoose.Schema({
  category: { type: String, required: true, index: true }, // 'lesson' | 'pattern' | 'feedback' | 'rule_adjustment'
  key: { type: String, required: true },
  content: { type: String, required: true },  // 自然语言描述
  data: mongoose.Schema.Types.Mixed,          // 结构化数据
  confidence: { type: Number, default: 0.5 }, // 置信度 0-1
  validations: { type: Number, default: 1 },  // 被验证的次数
  source: { type: String, enum: ['reflection', 'user_feedback', 'statistical', 'evolution'] },
  relatedCampaigns: [String],
  relatedPackages: [String],
  tags: [String],
}, { timestamps: true })

longTermSchema.index({ category: 1, confidence: -1 })
longTermSchema.index({ tags: 1 })
longTermSchema.index({ key: 1 }, { unique: true })
const LongTermMemory = mongoose.model('AgentLongMemory', longTermSchema)

// ==================== 记忆服务 ====================

class MemoryService {
  // ---------- 工作记忆 (Redis) ----------

  async setWorking(key: string, value: any, ttlSeconds = 900): Promise<void> {
    try {
      const redis = getRedis()
      if (!redis) return
      await redis.set(`agent:working:${key}`, JSON.stringify(value), 'EX', ttlSeconds)
    } catch { /* Redis optional */ }
  }

  async getWorking<T = any>(key: string): Promise<T | null> {
    try {
      const redis = getRedis()
      if (!redis) return null
      const data = await redis.get(`agent:working:${key}`)
      return data ? JSON.parse(data) : null
    } catch { return null }
  }

  /** 获取 Agent 当前的注意力焦点 */
  async getFocus(): Promise<string[]> {
    return await this.getWorking<string[]>('focus') || []
  }

  async setFocus(items: string[]): Promise<void> {
    await this.setWorking('focus', items, 3600)
  }

  // ---------- 短期记忆 (MongoDB, 7天) ----------

  async rememberShort(category: string, key: string, content: any, ttlDays = 7): Promise<void> {
    await ShortTermMemory.findOneAndUpdate(
      { category, key },
      { content, expiresAt: new Date(Date.now() + ttlDays * 86400000) },
      { upsert: true }
    )
  }

  async recallShort(category: string, key?: string, limit = 20): Promise<any[]> {
    const query: any = { category }
    if (key) query.key = key
    return ShortTermMemory.find(query).sort({ createdAt: -1 }).limit(limit).lean()
  }

  /** 获取未完成的任务 */
  async getPendingTasks(): Promise<any[]> {
    return this.recallShort('task')
  }

  /** 记录一次观察 */
  async recordObservation(key: string, data: any): Promise<void> {
    await this.rememberShort('observation', key, data, 3)
  }

  // ---------- 长期记忆 (MongoDB, 永久) ----------

  async learnLesson(key: string, content: string, data: any, source: string, tags: string[] = []): Promise<void> {
    const existing = await LongTermMemory.findOne({ key })
    if (existing) {
      // 已有此经验，增加置信度
      existing.validations += 1
      existing.confidence = Math.min(1, existing.confidence + 0.1)
      existing.content = content
      existing.data = data
      await existing.save()
      log.info(`[Memory] Lesson reinforced: ${key} (confidence: ${existing.confidence})`)
    } else {
      await LongTermMemory.create({
        category: 'lesson', key, content, data,
        confidence: 0.5, source, tags,
      })
      log.info(`[Memory] New lesson: ${key}`)
    }
  }

  async recallLessons(tags?: string[], limit = 10): Promise<any[]> {
    const query: any = { category: 'lesson' }
    if (tags?.length) query.tags = { $in: tags }
    return LongTermMemory.find(query).sort({ confidence: -1 }).limit(limit).lean()
  }

  async recordPattern(key: string, content: string, data: any): Promise<void> {
    await LongTermMemory.findOneAndUpdate(
      { key },
      { category: 'pattern', content, data, source: 'statistical', $inc: { validations: 1 } },
      { upsert: true }
    )
  }

  async recordFeedback(key: string, content: string, data: any): Promise<void> {
    await LongTermMemory.findOneAndUpdate(
      { key },
      { category: 'feedback', content, data, source: 'user_feedback', confidence: 0.9 },
      { upsert: true }
    )
  }

  // ---------- 构建上下文 ----------

  /** 为 LLM 决策构建记忆上下文 */
  async buildContext(campaignIds: string[] = [], tags: string[] = []): Promise<string> {
    const parts: string[] = []

    // 相关经验
    const lessons = await this.recallLessons(tags, 5)
    if (lessons.length > 0) {
      parts.push('## 历史经验')
      for (const l of lessons) {
        parts.push(`- [置信度${l.confidence}] ${l.content}`)
      }
    }

    // 用户反馈
    const feedback = await LongTermMemory.find({ category: 'feedback' }).sort({ updatedAt: -1 }).limit(3).lean()
    if (feedback.length > 0) {
      parts.push('\n## 用户反馈')
      for (const f of feedback) {
        parts.push(`- ${f.content}`)
      }
    }

    // 最近决策
    const recentDecisions = await this.recallShort('decision', undefined, 5)
    if (recentDecisions.length > 0) {
      parts.push('\n## 最近决策')
      for (const d of recentDecisions) {
        parts.push(`- ${d.content?.summary || d.key}`)
      }
    }

    return parts.join('\n') || '暂无历史经验。'
  }
}

export const memory = new MemoryService()
