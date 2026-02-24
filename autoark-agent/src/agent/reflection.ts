/**
 * 反思层 - Agent 的自我评估
 * 每个决策执行后 2-4 小时回顾效果，积累经验
 * 反思结果写回对应 Skill 的 stats 和 learnedNotes
 */
import dayjs from 'dayjs'
import axios from 'axios'
import { log } from '../platform/logger'
import { Action } from '../action/action.model'
import { Skill } from './skill.model'
import { memory } from './memory.service'
import { CampaignMetrics } from './analyzer'

export interface ReflectionResult {
  decisionId: string
  campaignId: string
  type: string
  assessment: 'correct' | 'wrong' | 'unclear'
  reason: string
  lesson: string
  metricsBefore: { spend: number; roas: number }
  metricsAfter: { spend: number; roas: number }
}

/**
 * 反思一个已执行的决策
 */
export async function reflectOnDecision(
  action: any,
  currentCampaigns: Map<string, CampaignMetrics>,
): Promise<ReflectionResult | null> {
  const campaignId = action.entityId
  if (!campaignId) return null

  const current = currentCampaigns.get(campaignId)

  // 决策时的指标（从 action 记录里拿）
  const beforeRoas = action.params?.roasAtDecision || 0
  const beforeSpend = action.params?.spendAtDecision || 0

  const result: ReflectionResult = {
    decisionId: action._id.toString(),
    campaignId,
    type: action.type,
    assessment: 'unclear',
    reason: '',
    lesson: '',
    metricsBefore: { spend: beforeSpend, roas: beforeRoas },
    metricsAfter: { spend: current?.todaySpend || 0, roas: current?.todayRoas || 0 },
  }

  if (action.type === 'pause') {
    // 关停决策评估：如果关停时 ROAS 确实很差，那就是对的
    if (beforeRoas < 0.5 && beforeSpend > 30) {
      result.assessment = 'correct'
      result.reason = `关停时 ROAS ${beforeRoas}，花费 $${beforeSpend}，决策正确`
      result.lesson = `${action.entityName || campaignId} 的 ROAS 持续低于 0.5，关停是正确的`
    } else if (current && current.todayRoas > 1.5) {
      // 关停了但其实效果还行（误杀）
      result.assessment = 'wrong'
      result.reason = `关停后该 campaign 类似的新 campaign ROAS 恢复到 ${current.todayRoas}`
      result.lesson = `类似 campaign 可能只是暂时波动，不应过早关停`
    } else {
      result.assessment = 'unclear'
      result.reason = `关停后无法确定效果，数据不足`
    }
  }

  if (action.type === 'adjust_budget' || action.type === 'increase_budget') {
    const newBudget = action.params?.newBudget || 0
    const afterRoas = current?.todayRoas || 0

    if (afterRoas >= beforeRoas * 0.8) {
      // 加预算后 ROAS 没有明显下降
      result.assessment = 'correct'
      result.reason = `加预算到 $${newBudget} 后 ROAS ${afterRoas}（之前 ${beforeRoas}），效果维持`
      result.lesson = `该 campaign 有扩量空间，加预算不会稀释效果`
    } else if (afterRoas < beforeRoas * 0.6) {
      result.assessment = 'wrong'
      result.reason = `加预算后 ROAS 从 ${beforeRoas} 降到 ${afterRoas}，下降 ${Math.round((1 - afterRoas / beforeRoas) * 100)}%`
      result.lesson = `该 campaign 已到扩量瓶颈，加预算导致效果稀释`
    } else {
      result.assessment = 'unclear'
      result.reason = `ROAS 变化不大，无法判断`
    }
  }

  return result
}

/**
 * 批量反思所有待复盘的决策，并存入记忆
 */
export async function reflectAll(
  currentCampaigns: Map<string, CampaignMetrics>,
): Promise<ReflectionResult[]> {
  // 找 2-24 小时前执行的、还没反思过的决策
  const actions = await Action.find({
    status: 'executed',
    executedAt: {
      $gte: dayjs().subtract(24, 'hour').toDate(),
      $lte: dayjs().subtract(2, 'hour').toDate(),
    },
    'params.reflected': { $ne: true },
  }).lean()

  if (actions.length === 0) return []

  const results: ReflectionResult[] = []

  for (const action of actions) {
    const result = await reflectOnDecision(action, currentCampaigns)
    if (!result) continue

    results.push(result)

    // 标记已反思
    await Action.updateOne(
      { _id: (action as any)._id },
      { $set: { 'params.reflected': true, 'params.reflection': result } }
    )

    // 写回对应 Skill 的 stats
    const skillName = (action as any).params?.skillName
    if (skillName && result.assessment !== 'unclear') {
      try {
        const update: any = {}
        if (result.assessment === 'correct') {
          update.$inc = { 'stats.correct': 1 }
        } else if (result.assessment === 'wrong') {
          update.$inc = { 'stats.wrong': 1 }
          update.$push = { learnedNotes: { $each: [result.lesson], $slice: -10 } }
        }
        if (update.$inc || update.$push) {
          await Skill.updateOne({ name: skillName }, update)
          // 重算准确率
          const skill = await Skill.findOne({ name: skillName }).select('stats').lean() as any
          if (skill?.stats) {
            const total = (skill.stats.correct || 0) + (skill.stats.wrong || 0)
            const accuracy = total > 0 ? Math.round((skill.stats.correct || 0) / total * 100) : 0
            await Skill.updateOne({ name: skillName }, { $set: { 'stats.accuracy': accuracy } })
          }
        }
      } catch { /* non-critical */ }
    }

    // 写入记忆
    if (result.assessment !== 'unclear') {
      const tags = [result.type, result.assessment]
      if (skillName) tags.push(`skill:${skillName}`)
      if ((action as any).entityName) {
        const pkg = (action as any).entityName?.match(/fb_(\w+)_/)?.[1]
        if (pkg) tags.push(`pkg:${pkg}`)
      }

      await memory.learnLesson(
        `reflection:${result.decisionId}`,
        result.lesson,
        { ...result, actionParams: (action as any).params },
        'reflection',
        tags
      )
    }

    // 记录到短期记忆
    await memory.rememberShort('reflection', result.decisionId, result, 7)

    log.info(`[Reflection] ${result.campaignId}: ${result.assessment} - ${result.reason}${skillName ? ` (skill: ${skillName})` : ''}`)
  }

  return results
}

/**
 * 统计反思结果，用于进化机制
 */
export async function getReflectionStats(days = 7): Promise<{
  total: number; correct: number; wrong: number; unclear: number; accuracy: number
}> {
  const since = dayjs().subtract(days, 'day').toDate()
  const actions = await Action.find({
    status: 'executed',
    'params.reflected': true,
    executedAt: { $gte: since },
  }).lean()

  let correct = 0, wrong = 0, unclear = 0
  for (const a of actions) {
    const r = (a as any).params?.reflection?.assessment
    if (r === 'correct') correct++
    else if (r === 'wrong') wrong++
    else unclear++
  }

  const total = correct + wrong + unclear
  return { total, correct, wrong, unclear, accuracy: total > 0 ? Math.round(correct / (correct + wrong) * 100) : 0 }
}
