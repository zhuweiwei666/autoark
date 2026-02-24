/**
 * 记忆层 - Agent 的大脑存储
 *
 * 三层架构：
 *   工作记忆(Redis) + 短期记忆(MongoDB 7天TTL) + 长期知识(Knowledge 表，统一知识层)
 *
 * 长期知识统一存储在 Knowledge 表（librarian.model.ts），不再使用独立的 LongTermMemory。
 * 这样 Librarian 沉淀的知识和 Reflection 学到的经验共享同一个置信度体系。
 */
import { getRedis } from '../config/redis'
import { log } from '../platform/logger'
import mongoose from 'mongoose'
import { Knowledge } from './librarian.model'

// ==================== 短期记忆模型 (7天自动清理) ====================

const shortTermSchema = new mongoose.Schema({
  category: { type: String, required: true, index: true },
  key: { type: String, required: true },
  content: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, index: { expires: 0 } },
}, { timestamps: true })

shortTermSchema.index({ category: 1, key: 1 })
const ShortTermMemory = mongoose.model('AgentShortMemory', shortTermSchema)

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

  async getPendingTasks(): Promise<any[]> {
    return this.recallShort('task')
  }

  async recordObservation(key: string, data: any): Promise<void> {
    await this.rememberShort('observation', key, data, 3)
  }

  // ---------- 长期知识 (统一 Knowledge 表) ----------

  async learnLesson(key: string, content: string, data: any, source: string, tags: string[] = []): Promise<void> {
    const knowledgeSource = source === 'reflection' ? 'reflection' : 'statistical'
    const existing = await Knowledge.findOne({ key })
    if (existing) {
      existing.set('validations', (existing.get('validations') || 1) + 1)
      existing.set('confidence', Math.min(1, (existing.get('confidence') || 0.5) + 0.1))
      existing.set('content', content)
      existing.set('data', data)
      existing.set('lastValidatedAt', new Date())
      await existing.save()
      log.info(`[Memory] Lesson reinforced: ${key} (confidence: ${existing.get('confidence')})`)
    } else {
      await Knowledge.create({
        category: 'decision_lesson',
        key,
        content,
        data,
        confidence: 0.5,
        source: knowledgeSource,
        tags,
        lastValidatedAt: new Date(),
      })
      log.info(`[Memory] New lesson: ${key}`)
    }
  }

  async recallLessons(tags?: string[], limit = 10): Promise<any[]> {
    const query: any = {
      category: 'decision_lesson',
      archived: { $ne: true },
    }
    if (tags?.length) query.tags = { $in: tags }
    return Knowledge.find(query).sort({ confidence: -1 }).limit(limit).lean()
  }

  async recordPattern(key: string, content: string, data: any): Promise<void> {
    await Knowledge.findOneAndUpdate(
      { key },
      {
        category: 'campaign_pattern',
        content,
        data,
        source: 'statistical',
        lastValidatedAt: new Date(),
        $inc: { validations: 1 },
        $setOnInsert: { confidence: 0.5 },
      },
      { upsert: true }
    )
  }

  async recordFeedback(key: string, content: string, data: any): Promise<void> {
    await Knowledge.findOneAndUpdate(
      { key },
      {
        category: 'user_preference',
        content,
        data,
        source: 'user_feedback',
        confidence: 0.9,
        lastValidatedAt: new Date(),
        $inc: { validations: 1 },
      },
      { upsert: true }
    )
  }

  // ---------- 构建上下文 ----------

  async buildContext(campaignIds: string[] = [], tags: string[] = []): Promise<string> {
    const parts: string[] = []

    const lessons = await this.recallLessons(tags, 5)
    if (lessons.length > 0) {
      parts.push('## 历史经验')
      for (const l of lessons) {
        parts.push(`- [置信度${(l as any).confidence}] ${l.content}`)
      }
    }

    const feedback = await Knowledge.find({
      category: 'user_preference',
      archived: { $ne: true },
    }).sort({ updatedAt: -1 }).limit(3).lean()
    if (feedback.length > 0) {
      parts.push('\n## 用户反馈')
      for (const f of feedback) {
        parts.push(`- ${f.content}`)
      }
    }

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
