/**
 * Stage 4: 自进化引擎
 * Agent 通过反思发现模式，自动提出 Skill 调整建议
 */
import dayjs from 'dayjs'
import axios from 'axios'
import { log } from '../platform/logger'
import { env } from '../config/env'
import { Action } from '../action/action.model'
import { Skill } from './skill.model'
import { memory } from './memory.service'
import { getReflectionStats } from './reflection'

export interface EvolutionProposal {
  type: 'adjust_threshold' | 'new_skill' | 'add_rule' | 'remove_rule'
  skillId?: string
  skillName?: string
  description: string
  reason: string
  confidence: number
  data: any
}

/**
 * 周度进化分析 - 回顾过去 7 天决策效果，提出调整建议
 */
export async function runEvolution(): Promise<EvolutionProposal[]> {
  log.info('[Evolution] Running weekly evolution analysis...')
  const proposals: EvolutionProposal[] = []

  // 收集反思数据
  const since = dayjs().subtract(7, 'day').toDate()
  const actions = await Action.find({
    status: { $in: ['executed', 'approved'] },
    'params.reflected': true,
    executedAt: { $gte: since },
  }).lean()

  if (actions.length < 5) {
    log.info('[Evolution] Not enough data (need 5+ reflected decisions)')
    return []
  }

  // 分析错误决策的模式
  const wrong = actions.filter((a: any) => a.params?.reflection?.assessment === 'wrong')
  const correct = actions.filter((a: any) => a.params?.reflection?.assessment === 'correct')

  // 模式 1: 某类操作的错误率过高
  const typeStats: Record<string, { total: number; wrong: number }> = {}
  for (const a of actions) {
    const t = (a as any).type
    if (!typeStats[t]) typeStats[t] = { total: 0, wrong: 0 }
    typeStats[t].total++
    if ((a as any).params?.reflection?.assessment === 'wrong') typeStats[t].wrong++
  }

  for (const [type, stats] of Object.entries(typeStats)) {
    if (stats.total >= 3 && stats.wrong / stats.total > 0.4) {
      proposals.push({
        type: 'adjust_threshold',
        description: `"${type}" 操作错误率 ${Math.round(stats.wrong / stats.total * 100)}%（${stats.wrong}/${stats.total}）`,
        reason: `过去7天 ${type} 操作中 ${stats.wrong} 个判断错误，建议收紧触发条件`,
        confidence: 0.7,
        data: stats,
      })
    }
  }

  // 模式 2: 被拒绝的操作 → 用户偏好未充分学习
  const rejected = await Action.countDocuments({ status: 'rejected', createdAt: { $gte: since } })
  const totalPending = await Action.countDocuments({ createdAt: { $gte: since }, status: { $in: ['approved', 'rejected', 'pending'] } })
  if (totalPending > 5 && rejected / totalPending > 0.3) {
    proposals.push({
      type: 'add_rule',
      description: `审批拒绝率 ${Math.round(rejected / totalPending * 100)}%`,
      reason: `用户拒绝了 ${rejected} 个操作（总 ${totalPending} 个），Agent 的判断标准需要调整`,
      confidence: 0.8,
      data: { rejected, total: totalPending },
    })
  }

  // 模式 3: 用 LLM 分析（如果有 API key）
  if (env.LLM_API_KEY && wrong.length >= 3) {
    try {
      const wrongSummary = wrong.slice(0, 10).map((a: any) => ({
        type: a.type, campaign: a.entityName, reason: a.reason,
        reflection: a.params?.reflection?.reason,
      }))

      const res = await axios.post(`${env.LLM_BASE_URL}/chat/completions`, {
        model: env.LLM_MODEL,
        messages: [
          { role: 'system', content: '你是一个广告投放策略优化专家。分析以下错误决策，发现模式，提出改进建议。输出 JSON。' },
          { role: 'user', content: `过去7天的错误决策：\n${JSON.stringify(wrongSummary, null, 2)}\n\n请分析共同模式，提出 1-3 条改进建议。格式：\n[{"suggestion":"建议","reason":"原因","confidence":0.7}]` },
        ],
        temperature: 0.3, max_tokens: 1024,
      }, {
        headers: { 'Authorization': `Bearer ${env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      })

      const content = res.data.choices?.[0]?.message?.content || ''
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0])
        for (const s of suggestions) {
          proposals.push({
            type: 'add_rule',
            description: s.suggestion,
            reason: s.reason,
            confidence: s.confidence || 0.6,
            data: { source: 'llm_analysis' },
          })
        }
      }
    } catch (e: any) {
      log.warn('[Evolution] LLM analysis failed:', e.message)
    }
  }

  // 存入记忆
  if (proposals.length > 0) {
    const stats = await getReflectionStats(7)
    await memory.rememberShort('evolution', `week_${dayjs().format('YYYYWW')}`, {
      proposals,
      stats,
      summary: `${proposals.length} 条优化建议，7天准确率 ${stats.accuracy}%`,
    })
    log.info(`[Evolution] Generated ${proposals.length} proposals`)
  }

  return proposals
}
