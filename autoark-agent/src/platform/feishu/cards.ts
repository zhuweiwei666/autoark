/**
 * 飞书卡片模板 — 摘要 / 审批 / 告警
 */
import dayjs from 'dayjs'
import type { NotifyFeishuParams } from './feishu.service'
import type { MarketBenchmark } from '../../agent/brain'

/**
 * 每轮决策摘要卡片
 */
export function buildSummaryCard(params: NotifyFeishuParams) {
  const { screening, actions, events, benchmarks, classSummary } = params
  const now = dayjs().format('YYYY-MM-DD HH:mm')
  const autoCount = actions.filter((a: any) => a.auto).length
  const approvalCount = actions.filter((a: any) => !a.auto).length
  const criticalCount = events.filter((e: any) => e.type === 'spend_spike' || e.type === 'roas_crash').length

  const actionLines: string[] = []
  if (actions.length === 0) {
    actionLines.push('无操作建议')
  } else {
    const pauseCount = actions.filter((a: any) => a.type === 'pause').length
    const budgetCount = actions.filter((a: any) => a.type === 'increase_budget' || a.type === 'adjust_budget').length
    if (pauseCount > 0) actionLines.push(`暂停 ${pauseCount} 个 campaign`)
    if (budgetCount > 0) actionLines.push(`加预算 ${budgetCount} 个 campaign`)
    actionLines.push(`${autoCount} 自动 / ${approvalCount} 待审批`)
  }

  const classLine = classSummary
    ? `严重亏损 ${classSummary.loss_severe || 0} | 轻微亏损 ${classSummary.loss_mild || 0} | 高潜力 ${classSummary.high_potential || 0} | 稳定 ${(classSummary.stable_good || 0) + (classSummary.stable_normal || 0)} | 观察 ${classSummary.observing || 0}`
    : ''

  return {
    config: { wide_screen_mode: true },
    header: {
      template: criticalCount > 0 ? 'red' : actions.length > 0 ? 'blue' : 'turquoise',
      title: { content: `AutoArk Agent 决策报告 | ${now}`, tag: 'plain_text' },
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { content: `**扫描**\n${screening.total} campaigns`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**总花费**\n$${benchmarks.totalSpend}`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**ROAS**\n${benchmarks.weightedRoas}`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**大盘 P50**\n${benchmarks.medianRoi}`, tag: 'lark_md' } },
        ],
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          content: `**筛选结果**\n需决策: ${screening.needsDecision} | 观察: ${screening.watch} | 跳过: ${screening.skip}`,
          tag: 'lark_md',
        },
      },
      ...(classLine ? [{
        tag: 'div' as const,
        text: { content: `**分类统计**\n${classLine}`, tag: 'lark_md' as const },
      }] : []),
      { tag: 'hr' },
      {
        tag: 'div',
        text: { content: `**操作建议**\n${actionLines.join('\n')}`, tag: 'lark_md' },
      },
      ...(criticalCount > 0 ? [{
        tag: 'div' as const,
        text: { content: `**异常事件**: ${criticalCount} 个紧急`, tag: 'lark_md' as const },
      }] : []),
      ...(Object.keys(screening.skillHits).length > 0 ? [{
        tag: 'note' as const,
        elements: [{
          tag: 'plain_text' as const,
          content: `Skills: ${Object.entries(screening.skillHits).map(([k, v]) => `${k}(${v})`).join(' | ')}`,
        }],
      }] : []),
    ],
  }
}

/**
 * 操作审批卡片
 */
export function buildApprovalCard(action: any, benchmarks: MarketBenchmark) {
  const isUrgent = action.auto || action.priority === 'critical'
  const actionLabel = action.type === 'pause' ? 'PAUSE' :
    action.type === 'increase_budget' ? 'INCREASE BUDGET' :
    action.type === 'decrease_budget' ? 'DECREASE BUDGET' :
    action.type.toUpperCase()

  const fields = [
    { is_short: true, text: { content: `**Campaign**\n${action.campaignName || action.campaignId}`, tag: 'lark_md' } },
    { is_short: true, text: { content: `**操作**\n${actionLabel}`, tag: 'lark_md' } },
  ]

  if (action.currentBudget && action.newBudget) {
    fields.push({ is_short: true, text: { content: `**预算**\n$${action.currentBudget} → $${action.newBudget}`, tag: 'lark_md' } })
  }

  if (action.skillName) {
    fields.push({ is_short: true, text: { content: `**触发 Skill**\n${action.skillName}`, tag: 'lark_md' } })
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: isUrgent ? 'red' : 'blue',
      title: { content: `AutoArk 策略审批: ${actionLabel} ${isUrgent ? '| 紧急' : ''}`, tag: 'plain_text' },
    },
    elements: [
      { tag: 'div', fields },
      { tag: 'div', text: { content: `**决策依据**\n${action.reason}`, tag: 'lark_md' } },
      ...(benchmarks ? [{
        tag: 'note' as const,
        elements: [{
          tag: 'plain_text' as const,
          content: `大盘参考: P25=${benchmarks.p25Roi} P50=${benchmarks.medianRoi} P75=${benchmarks.p75Roi} | 加权ROAS=${benchmarks.weightedRoas}`,
        }],
      }] : []),
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { content: '通过审批', tag: 'plain_text' },
            type: 'primary',
            value: { action: 'approve', actionData: JSON.stringify({ campaignId: action.campaignId, type: action.type }) },
          },
          {
            tag: 'button',
            text: { content: '拒绝', tag: 'plain_text' },
            type: 'danger',
            value: { action: 'reject', actionData: JSON.stringify({ campaignId: action.campaignId, type: action.type }) },
          },
        ],
      },
    ],
  }
}

/**
 * 紧急告警卡片
 */
export function buildAlertCard(event: any) {
  const typeLabels: Record<string, string> = {
    spend_spike: '花费飙升',
    roas_crash: 'ROI 暴跌',
    zero_conversion: '零转化',
  }
  const label = typeLabels[event.type] || event.type

  let detail = ''
  if (event.type === 'spend_spike') {
    detail = `花费速率是正常值的 ${event.ratio?.toFixed(1) || '?'}x`
  } else if (event.type === 'roas_crash') {
    detail = `ROI 从 ${event.before?.toFixed(2) || '?'} 跌至 ${event.after?.toFixed(2) || '?'}, 下降 ${event.dropPct?.toFixed(0) || '?'}%`
  } else if (event.type === 'zero_conversion') {
    detail = `花费 $${event.spend?.toFixed(0) || '?'}, 运行 ${event.hours || '?'}h, 零转化`
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'red',
      title: { content: `AutoArk 紧急告警: ${label}`, tag: 'plain_text' },
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { content: `**Campaign**\n${event.campaignName || event.campaignId}`, tag: 'lark_md' } },
          { is_short: true, text: { content: `**类型**\n${label}`, tag: 'lark_md' } },
        ],
      },
      { tag: 'div', text: { content: `**详情**\n${detail}`, tag: 'lark_md' } },
    ],
  }
}
