/**
 * 上下文工程 - 精心构造 LLM "看到的世界"
 * 
 * 注入到决策 prompt 里的动态上下文：
 * 1. 时间感知（周末/凌晨/晚间）
 * 2. 数据质量提示（今天数据到几点了、小花费不可靠）
 * 3. 历史经验（反思学到的 lessons）
 * 4. 用户偏好（被否决的决策 → 学到的偏好）
 */
import dayjs from 'dayjs'
import { memory } from './memory.service'
import { Action } from '../action/action.model'

/**
 * 构建完整的动态上下文（注入到 LLM 决策 prompt 前）
 */
export async function buildDynamicContext(): Promise<string> {
  const parts: string[] = []

  // 1. 时间感知
  parts.push(getTimeContext())

  // 2. 数据质量提示
  parts.push(getDataQualityContext())

  // 3. 历史经验
  const lessonsCtx = await getLessonsContext()
  if (lessonsCtx) parts.push(lessonsCtx)

  // 4. 用户偏好（从否决记录学习）
  const prefCtx = await getUserPreferenceContext()
  if (prefCtx) parts.push(prefCtx)

  // 5. 最近操作记录（避免重复操作）
  const recentCtx = await getRecentActionsContext()
  if (recentCtx) parts.push(recentCtx)

  return parts.filter(Boolean).join('\n\n')
}

// ==================== 时间感知 ====================

function getTimeContext(): string {
  const hour = (dayjs().hour() + 8) % 24  // UTC → 北京时间
  const dayOfWeek = dayjs().add(8, 'hour').day() // UTC → 北京时间的星期
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

  const parts = ['## 当前时间背景']
  parts.push(`当前: ${dayjs().format('YYYY-MM-DD HH:mm')} ${isWeekend ? '(周末)' : '(工作日)'}`)

  if (isWeekend) {
    parts.push('- 周末流量模式与工作日不同，游戏类通常偏高，电商类通常偏低')
    parts.push('- 建议不做大的预算调整，等工作日数据稳定后再决定')
  }

  if (hour < 6) {
    parts.push('- 凌晨时段，今日数据非常不完整（<25%），不建议做任何关停决策')
    parts.push('- 只处理明确的异常（如花费飙升）')
  } else if (hour < 10) {
    parts.push('- 上午早间，今日数据量有限，ROAS 波动大，谨慎决策')
  } else if (hour >= 14 && hour < 18) {
    parts.push('- 下午时段，今日数据量较充足，可以做趋势判断')
  } else if (hour >= 20) {
    parts.push('- 晚间时段，今日数据基本完整，适合做日终分析和决策')
  }

  return parts.join('\n')
}

// ==================== 数据质量 ====================

function getDataQualityContext(): string {
  const bjHour = (dayjs().hour() + 8) % 24
  const minutesPassed = bjHour * 60 + dayjs().minute()
  const dataCoverage = Math.round((minutesPassed / 1440) * 100)

  return `## 数据质量提示
- 今日数据覆盖率: ${dataCoverage}%（截至 ${dayjs().format('HH:mm')}）
- 预估全天花费 = 今日花费 / ${dataCoverage}% * 100%（仅参考）
- 花费 < $10 的 campaign 数据波动极大，ROAS 不可靠
- 花费 < $30 的建议归入"观察期"，不做操作判断
- 新开投的 campaign（<24h）可能还在学习期，性能不稳定是正常的`
}

// ==================== 历史经验 ====================

async function getLessonsContext(): Promise<string | null> {
  const lessons = await memory.recallLessons(undefined, 8)
  if (lessons.length === 0) return null

  const parts = ['## 历史经验（Agent 自己学到的）']
  for (const l of lessons) {
    const conf = Math.round(l.confidence * 100)
    parts.push(`- [置信度${conf}%] ${l.content}`)
  }
  parts.push('')
  parts.push('请参考以上经验做决策，但不要机械套用，结合当前数据判断。')

  return parts.join('\n')
}

// ==================== 用户偏好 ====================

async function getUserPreferenceContext(): Promise<string | null> {
  // 从被拒绝的操作里学习用户偏好
  const rejections = await Action.find({ status: 'rejected' })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()

  if (rejections.length === 0) return null

  const parts = ['## 用户偏好（从审批记录学习）']

  // 统计被拒绝的操作类型
  const rejectTypes: Record<string, number> = {}
  for (const r of rejections) {
    const key = (r as any).type || 'unknown'
    rejectTypes[key] = (rejectTypes[key] || 0) + 1
    const note = (r as any).reviewNote
    if (note) {
      parts.push(`- 用户拒绝了 ${key}（${(r as any).entityName || ''}）：${note}`)
    }
  }

  // 总结倾向
  if (rejectTypes['pause'] > 3) {
    parts.push('- 注意：用户倾向于不轻易关停 campaign，请提高关停门槛')
  }
  if (rejectTypes['adjust_budget'] > 3) {
    parts.push('- 注意：用户对预算调整比较谨慎，请保守建议')
  }

  return parts.join('\n')
}

// ==================== 最近操作 ====================

async function getRecentActionsContext(): Promise<string | null> {
  const recent = await Action.find({
    status: { $in: ['executed', 'approved'] },
    createdAt: { $gte: dayjs().subtract(24, 'hour').toDate() },
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()

  if (recent.length === 0) return null

  const parts = ['## 最近 24h 已执行的操作']
  for (const a of recent) {
    parts.push(`- ${(a as any).type} ${(a as any).entityName || (a as any).entityId}: ${(a as any).reason?.substring(0, 60) || ''}`)
  }
  parts.push('')
  parts.push('注意：以上 campaign 最近已被操作过，除非情况急剧变化，否则不要重复操作。')

  return parts.join('\n')
}
