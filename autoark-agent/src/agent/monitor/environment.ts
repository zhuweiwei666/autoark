/**
 * 环境上下文 — 大盘情况、账户级趋势、时间因素
 */
import dayjs from 'dayjs'
import { RawCampaign } from './data-collector'
import { TimeSeries } from './timeseries.model'

/**
 * 构建环境上下文字符串（注入 LLM prompt）
 */
export async function buildEnvironment(campaigns: RawCampaign[]): Promise<string> {
  const parts: string[] = []
  const hour = (dayjs().hour() + 8) % 24  // UTC → 北京时间
  const now = dayjs()

  // 1. 时间背景
  const isWeekend = now.day() === 0 || now.day() === 6
  parts.push(`## 环境`)
  parts.push(`时间: ${now.format('YYYY-MM-DD HH:mm')} ${isWeekend ? '(周末)' : '(工作日)'}`)
  parts.push(`数据覆盖: 约 ${Math.round(hour / 24 * 100)}%（截至 ${hour}:00）`)

  // 2. 大盘汇总
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0)
  const withRoi = campaigns.filter(c => c.spend > 10 && (c.adjustedRoi || c.firstDayRoi) > 0)
  const weightedRoi = withRoi.length > 0
    ? withRoi.reduce((s, c) => s + (c.adjustedRoi || c.firstDayRoi) * c.spend, 0) / withRoi.reduce((s, c) => s + c.spend, 0)
    : 0

  parts.push(`大盘: ${campaigns.length} 个 campaign, 总花费 $${Math.round(totalSpend)}, 加权 ROI ${weightedRoi.toFixed(2)}`)

  // 3. 对比昨天同时段
  try {
    const yesterdaySameHour = dayjs().subtract(1, 'day').startOf('hour').toDate()
    const yData = await TimeSeries.find({
      sampledAt: { $gte: dayjs(yesterdaySameHour).subtract(15, 'minute').toDate(), $lte: dayjs(yesterdaySameHour).add(15, 'minute').toDate() },
    }).lean()

    if (yData.length > 10) {
      const ySpend = (yData as any[]).reduce((s: number, d: any) => s + (d.spend || 0), 0)
      if (ySpend > 0) {
        const change = ((totalSpend - ySpend) / ySpend * 100).toFixed(0)
        parts.push(`vs 昨天同时段: 花费 ${Number(change) > 0 ? '+' : ''}${change}%`)
      }
    }
  } catch { /* 首次运行没历史 */ }

  // 4. 按优化师汇总
  const optimizers = new Map<string, { spend: number; count: number; lowRoi: number }>()
  for (const c of campaigns) {
    if (!c.optimizer) continue
    const opt = optimizers.get(c.optimizer) || { spend: 0, count: 0, lowRoi: 0 }
    opt.spend += c.spend
    opt.count++
    if (c.spend > 10 && (c.adjustedRoi || c.firstDayRoi || 0) < 0.3) opt.lowRoi++
    optimizers.set(c.optimizer, opt)
  }

  const problemOptimizers = [...optimizers.entries()].filter(([, a]) => a.count >= 3 && a.lowRoi / a.count > 0.8)
  if (problemOptimizers.length > 0) {
    parts.push(`问题优化师: ${problemOptimizers.map(([name, a]) => `${name}(${a.lowRoi}/${a.count}低ROI)`).join(', ')}`)
  }

  // 5. 时间提示
  if (hour < 6) parts.push('提示: 凌晨数据极少，不建议做任何关停决策')
  if (isWeekend) parts.push('提示: 周末流量模式不同，避免大幅调整')
  if (hour >= 20) parts.push('提示: 接近日终，数据基本完整，适合做分析')

  return parts.join('\n')
}
