/**
 * 反思层 — Agent 的自我评估
 *
 * 决策执行后 2-24 小时回顾效果，积累经验。
 * 反思结果写回 Skill stats 和 learnedNotes，写入长期记忆。
 *
 * 修复的关键问题：
 * 1. pause 后 campaign 没有今日数据（已暂停），不能要求 currentCampaigns.get() 有值
 * 2. 决策时指标 (roasAtDecision/spendAtDecision) 可能为 0，需要从 action.reason 推断
 * 3. 减少 unclear 判定，尽量给出 correct/wrong
 */
import dayjs from 'dayjs'
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
  allCampaigns: CampaignMetrics[],
): Promise<ReflectionResult | null> {
  const campaignId = action.entityId
  if (!campaignId) return null

  const current = currentCampaigns.get(campaignId)
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

  const entityName = action.entityName || campaignId

  if (action.type === 'pause') {
    // pause 后 campaign 通常没有今日数据（已暂停），这是正常的
    // 评估策略：用决策时的指标判断是否该关

    if (beforeRoas > 0 && beforeRoas < 0.5 && beforeSpend > 20) {
      result.assessment = 'correct'
      result.reason = `关停时 ROAS ${beforeRoas.toFixed(2)}，花费 $${beforeSpend.toFixed(0)}，止损正确`
      result.lesson = `ROAS < 0.5 且花费 > $20 时关停是正确的 (${entityName})`
    } else if (beforeRoas >= 0.5 && beforeRoas < 1.0 && beforeSpend > 30) {
      // 处于临界区域，看同包名/同优化师的其他 campaign 是否也在下降
      const siblings = findSiblings(action, allCampaigns)
      if (siblings.length > 0) {
        const avgSiblingRoas = siblings.reduce((s, c) => s + c.todayRoas, 0) / siblings.length
        if (avgSiblingRoas < 0.8) {
          result.assessment = 'correct'
          result.reason = `关停时 ROAS ${beforeRoas.toFixed(2)}，同类 campaign 平均 ROAS ${avgSiblingRoas.toFixed(2)} 也偏低`
          result.lesson = `该产品整体 ROAS 偏低时，关停个别差的是正确的`
        } else if (avgSiblingRoas > 1.5) {
          result.assessment = 'wrong'
          result.reason = `关停时 ROAS ${beforeRoas.toFixed(2)}，但同类 campaign 平均 ROAS ${avgSiblingRoas.toFixed(2)} 表现不错，可能是误杀`
          result.lesson = `同类 campaign 表现好时，不应过早关停 ROAS 在 0.5-1.0 之间的`
        }
      }
      if (result.assessment === 'unclear' && beforeRoas < 0.8) {
        result.assessment = 'correct'
        result.reason = `关停时 ROAS ${beforeRoas.toFixed(2)} < 0.8，花费 $${beforeSpend.toFixed(0)}，止损合理`
        result.lesson = `ROAS < 0.8 且无上升趋势时关停是合理的`
      }
    } else if (beforeRoas >= 1.0) {
      result.assessment = 'wrong'
      result.reason = `关停时 ROAS ${beforeRoas.toFixed(2)} >= 1.0，不应该关停`
      result.lesson = `ROAS >= 1.0 的 campaign 不应该被关停，需要审查触发条件`
    } else if (beforeSpend <= 20 && beforeSpend > 0) {
      result.assessment = 'unclear'
      result.reason = `花费仅 $${beforeSpend.toFixed(0)}，数据太少无法判断`
    } else if (beforeRoas === 0 && beforeSpend === 0) {
      // 决策时指标缺失，尝试从 reason 文本推断
      const reasonLower = (action.reason || '').toLowerCase()
      if (reasonLower.includes('严重亏损') || reasonLower.includes('零转化')) {
        result.assessment = 'correct'
        result.reason = `根据决策原因推断：${action.reason}`
        result.lesson = `决策原因包含严重亏损/零转化关键词，通常是正确的关停`
      }
    }
  }

  if (action.type === 'adjust_budget' || action.type === 'increase_budget') {
    const afterRoas = current?.todayRoas || 0

    if (current && beforeRoas > 0) {
      if (afterRoas >= beforeRoas * 0.8) {
        result.assessment = 'correct'
        result.reason = `加预算后 ROAS ${afterRoas.toFixed(2)}（之前 ${beforeRoas.toFixed(2)}），效果维持`
        result.lesson = `${entityName} 有扩量空间`
      } else if (afterRoas < beforeRoas * 0.6) {
        result.assessment = 'wrong'
        result.reason = `加预算后 ROAS 从 ${beforeRoas.toFixed(2)} 降到 ${afterRoas.toFixed(2)}，下降 ${Math.round((1 - afterRoas / beforeRoas) * 100)}%`
        result.lesson = `${entityName} 已到扩量瓶颈`
      } else {
        result.assessment = 'unclear'
        result.reason = `ROAS 变化在 20%-40% 之间，需要更多数据`
      }
    } else if (!current && beforeRoas > 1.0) {
      result.assessment = 'correct'
      result.reason = `决策时 ROAS ${beforeRoas.toFixed(2)} > 1.0，加预算合理`
      result.lesson = `ROAS > 1.0 时加预算通常是合理的`
    }
  }

  return result
}

/**
 * 找同包名或同优化师的兄弟 campaign（用于对比判断）
 */
function findSiblings(action: any, allCampaigns: CampaignMetrics[]): CampaignMetrics[] {
  const name = action.entityName || ''
  const pkgMatch = name.match(/_fb_(\w+)_|_tt_(\w+)_/)
  const pkg = pkgMatch ? (pkgMatch[1] || pkgMatch[2]) : ''

  if (pkg) {
    return allCampaigns.filter(c =>
      c.campaignId !== action.entityId &&
      c.pkgName?.toLowerCase().includes(pkg.toLowerCase()) &&
      c.todaySpend > 10
    ).slice(0, 10)
  }

  return []
}

/**
 * 批量反思所有待复盘的决策
 */
export async function reflectAll(
  currentCampaigns: Map<string, CampaignMetrics>,
  allCampaigns?: CampaignMetrics[],
): Promise<ReflectionResult[]> {
  const actions = await Action.find({
    status: 'executed',
    executedAt: {
      $gte: dayjs().subtract(24, 'hour').toDate(),
      $lte: dayjs().subtract(2, 'hour').toDate(),
    },
    'params.reflected': { $ne: true },
  }).lean()

  if (actions.length === 0) return []

  const all = allCampaigns || [...currentCampaigns.values()]
  const results: ReflectionResult[] = []

  for (const action of actions) {
    const result = await reflectOnDecision(action, currentCampaigns, all)
    if (!result) continue

    results.push(result)

    await Action.updateOne(
      { _id: (action as any)._id },
      { $set: { 'params.reflected': true, 'params.reflection': result } }
    )

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
          const skill = await Skill.findOne({ name: skillName }).select('stats').lean() as any
          if (skill?.stats) {
            const total = (skill.stats.correct || 0) + (skill.stats.wrong || 0)
            const accuracy = total > 0 ? Math.round((skill.stats.correct || 0) / total * 100) : 0
            await Skill.updateOne({ name: skillName }, { $set: { 'stats.accuracy': accuracy } })
          }
        }
      } catch { /* non-critical */ }
    }

    if (result.assessment !== 'unclear') {
      const tags = [result.type, result.assessment]
      if (skillName) tags.push(`skill:${skillName}`)
      const pkg = (action as any).entityName?.match(/_fb_(\w+)_|_tt_(\w+)_/)
      if (pkg) tags.push(`pkg:${pkg[1] || pkg[2]}`)

      await memory.learnLesson(
        `reflection:${result.decisionId}`,
        result.lesson,
        { ...result, actionParams: (action as any).params },
        'reflection',
        tags
      )
    }

    await memory.rememberShort('reflection', result.decisionId, result, 7)
    log.info(`[Reflection] ${result.campaignId}: ${result.assessment} - ${result.reason}${skillName ? ` (skill: ${skillName})` : ''}`)
  }

  return results
}

/**
 * 统计反思结果
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
  return { total, correct, wrong, unclear, accuracy: total > 0 ? Math.round(correct / (correct + wrong || 1) * 100) : 0 }
}
