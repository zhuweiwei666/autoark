/**
 * 飞书卡片模板
 *
 * 1. 摘要卡片：包含筛选统计 + needs_decision 的 campaign 明细列表（可展开）
 * 2. 紧急止损卡片：仅 critical + auto 的暂停操作才独立推送（带审批）
 */
import dayjs from 'dayjs'
import type { NotifyFeishuParams } from './feishu.service'
import type { MarketBenchmark } from '../../agent/brain'

/**
 * 每轮决策摘要卡片（包含 campaign 明细）
 */
export function buildSummaryCard(params: NotifyFeishuParams) {
  const { screening, actions, events, benchmarks, classSummary, screenedCampaigns } = params
  const now = dayjs().format('MM-DD HH:mm')
  const criticalCount = events.filter((e: any) => e.type === 'spend_spike' || e.type === 'roas_crash').length

  const elements: any[] = []

  // 头部数据概览
  elements.push({
    tag: 'div',
    fields: [
      { is_short: true, text: { content: `**扫描**\n${screening.total} campaigns`, tag: 'lark_md' } },
      { is_short: true, text: { content: `**总花费**\n$${benchmarks.totalSpend}`, tag: 'lark_md' } },
      { is_short: true, text: { content: `**加权 ROAS**\n${benchmarks.weightedRoas}`, tag: 'lark_md' } },
      { is_short: true, text: { content: `**大盘 P25/P50/P75**\n${benchmarks.p25Roi}/${benchmarks.medianRoi}/${benchmarks.p75Roi}`, tag: 'lark_md' } },
    ],
  })

  // 筛选结果 + 分类
  elements.push({ tag: 'hr' })
  const classLine = classSummary
    ? `严重亏损 ${classSummary.loss_severe || 0} | 轻微亏损 ${classSummary.loss_mild || 0} | 高潜力 ${classSummary.high_potential || 0} | 衰退 ${classSummary.declining || 0} | 稳定 ${(classSummary.stable_good || 0) + (classSummary.stable_normal || 0)} | 观察 ${classSummary.observing || 0}`
    : ''
  elements.push({
    tag: 'div',
    text: {
      content: `**筛选**: 需决策 **${screening.needsDecision}** | 观察 ${screening.watch} | 跳过 ${screening.skip}\n${classLine ? `**分类**: ${classLine}` : ''}`,
      tag: 'lark_md',
    },
  })

  // 操作汇总
  if (actions.length > 0) {
    const pauseActions = actions.filter((a: any) => a.type === 'pause' || a.type === 'adjust_budget' && a.newBudget === 0)
    const budgetActions = actions.filter((a: any) => a.type === 'increase_budget' || (a.type === 'adjust_budget' && (a.newBudget || 0) > 0))
    const autoCount = actions.filter((a: any) => a.auto).length
    const parts = []
    if (pauseActions.length > 0) parts.push(`暂停 ${pauseActions.length}`)
    if (budgetActions.length > 0) parts.push(`加预算 ${budgetActions.length}`)
    parts.push(`(${autoCount} 自动 / ${actions.length - autoCount} 待审批)`)
    elements.push({
      tag: 'div',
      text: { content: `**操作**: ${parts.join(' | ')}`, tag: 'lark_md' },
    })
  }

  // needs_decision campaign 明细（核心改进：可展开的折叠列表）
  const needsDecisionResults = screening.results.filter(r => r.verdict === 'needs_decision')
  if (needsDecisionResults.length > 0) {
    elements.push({ tag: 'hr' })

    // 按优先级分组
    const criticals = needsDecisionResults.filter(r => r.priority === 'critical')
    const highs = needsDecisionResults.filter(r => r.priority === 'high')
    const normals = needsDecisionResults.filter(r => r.priority === 'normal' || r.priority === 'low')

    if (criticals.length > 0) {
      elements.push({
        tag: 'collapsible_panel',
        expanded: true,
        header: {
          title: { tag: 'plain_text', content: `🔴 紧急 (${criticals.length})` },
        },
        border: { color: 'red' },
        vertical_spacing: '8px',
        elements: criticals.flatMap(r => buildCampaignRow(r, screenedCampaigns, actions)),
      })
    }

    if (highs.length > 0) {
      elements.push({
        tag: 'collapsible_panel',
        expanded: false,
        header: {
          title: { tag: 'plain_text', content: `🟠 高优 (${highs.length})` },
        },
        border: { color: 'orange' },
        vertical_spacing: '8px',
        elements: highs.flatMap(r => buildCampaignRow(r, screenedCampaigns, actions)),
      })
    }

    if (normals.length > 0) {
      elements.push({
        tag: 'collapsible_panel',
        expanded: false,
        header: {
          title: { tag: 'plain_text', content: `🔵 一般 (${normals.length})` },
        },
        border: { color: 'blue' },
        vertical_spacing: '8px',
        elements: normals.flatMap(r => buildCampaignRow(r, screenedCampaigns, actions)),
      })
    }
  }

  // Skill 命中统计（底部注释）
  if (Object.keys(screening.skillHits).length > 0) {
    elements.push({
      tag: 'note',
      elements: [{
        tag: 'plain_text',
        content: `Skills: ${Object.entries(screening.skillHits).map(([k, v]) => `${k}(${v})`).join(' | ')}`,
      }],
    })
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: criticalCount > 0 ? 'red' : actions.length > 0 ? 'blue' : 'turquoise',
      title: { content: `AutoArk Agent | ${now} | ${screening.needsDecision} 需决策`, tag: 'plain_text' },
    },
    elements,
  }
}

/**
 * 构建单条 campaign 明细行（在摘要卡片内使用）
 * 如果有待审批的 action，附带"批准/拒绝"按钮
 */
function buildCampaignRow(
  r: any,
  screenedCampaigns: any[],
  actions: any[],
): any[] {
  const c = screenedCampaigns?.find((sc: any) => sc.campaignId === r.campaignId)
  const action = actions?.find((a: any) => a.campaignId === r.campaignId)

  const name = r.campaignName || r.campaignId || '?'
  const spend = c ? `$${Math.round(c.todaySpend)}` : '-'
  const roi = c ? (c.adjustedRoi || c.todayRoas || 0).toFixed(2) : '-'
  const skillTag = r.matchedSkill || ''
  const reason = r.reasons?.[0] || ''
  const actionTag = action ? (action.type === 'pause' ? '⏸ 暂停' : action.type === 'increase_budget' ? '📈 加预算' : action.type) : ''
  const autoTag = action?.auto ? ' (已自动执行)' : action ? '' : ''

  const elements: any[] = [
    {
      tag: 'div',
      text: {
        content: `**${name}**\n花费 ${spend} | ROI ${roi} | ${skillTag}\n${reason}${actionTag ? `\n→ ${actionTag}${autoTag}` : ''}`,
        tag: 'lark_md',
      },
    },
  ]

  if (action && !action.auto && !action.executed) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { content: `✅ 批准${actionTag}`, tag: 'plain_text' },
          type: 'primary',
          size: 'small',
          value: { action: 'approve', actionData: JSON.stringify({ campaignId: action.campaignId, type: action.type }) },
        },
        {
          tag: 'button',
          text: { content: '❌ 拒绝', tag: 'plain_text' },
          type: 'danger',
          size: 'small',
          value: { action: 'reject', actionData: JSON.stringify({ campaignId: action.campaignId, type: action.type }) },
        },
      ],
    })
  }

  return elements
}

/**
 * 已自动执行通知卡片（auto=true 执行完毕后推送，不带按钮）
 */
export function buildAutoExecutedCard(action: any, campaign: any, benchmarks: MarketBenchmark) {
  const name = action.campaignName || action.campaignId
  const spend = campaign ? `$${Math.round(campaign.todaySpend)}` : '-'
  const roi = campaign ? (campaign.adjustedRoi || campaign.todayRoas || 0).toFixed(2) : '-'
  const actionLabel = action.type === 'pause' ? '已暂停' :
    action.type === 'increase_budget' || action.type === 'adjust_budget' ? '已加预算' :
    action.type === 'resume' ? '已恢复' : action.type

  const fields = [
    { is_short: true, text: { content: `**Campaign**\n${name}`, tag: 'lark_md' } },
    { is_short: true, text: { content: `**操作**\n${actionLabel}`, tag: 'lark_md' } },
    { is_short: true, text: { content: `**花费**\n${spend}`, tag: 'lark_md' } },
    { is_short: true, text: { content: `**ROI**\n${roi}`, tag: 'lark_md' } },
  ]

  if (action.currentBudget && action.newBudget) {
    fields.push({ is_short: true, text: { content: `**预算**\n$${action.currentBudget} → $${action.newBudget}`, tag: 'lark_md' } })
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: action.type === 'pause' ? 'red' : 'green',
      title: { content: `AutoArk 已自动执行: ${actionLabel} ${name}`, tag: 'plain_text' },
    },
    elements: [
      { tag: 'div', fields },
      { tag: 'div', text: { content: `**原因**\n${action.reason || '-'}`, tag: 'lark_md' } },
      ...(action.skillName ? [{ tag: 'note' as const, elements: [{ tag: 'plain_text' as const, content: `Skill: ${action.skillName} | 大盘 P25=${benchmarks.p25Roi} P50=${benchmarks.medianRoi}` }] }] : []),
    ],
  }
}

/**
 * 审批卡片（auto=false 的操作，带批准/拒绝按钮）
 */
export function buildApprovalCard(action: any, campaign: any, benchmarks: MarketBenchmark) {
  const name = action.campaignName || action.campaignId
  const spend = campaign ? `$${Math.round(campaign.todaySpend)}` : '-'
  const roi = campaign ? (campaign.adjustedRoi || campaign.todayRoas || 0).toFixed(2) : '-'
  const actionLabel = action.type === 'pause' ? 'PAUSE' :
    action.type === 'increase_budget' || action.type === 'adjust_budget' ? 'INCREASE BUDGET' :
    action.type === 'resume' ? 'RESUME' : action.type.toUpperCase()

  const fields = [
    { is_short: true, text: { content: `**Campaign**\n${name}`, tag: 'lark_md' } },
    { is_short: true, text: { content: `**操作**\n${actionLabel}`, tag: 'lark_md' } },
    { is_short: true, text: { content: `**花费**\n${spend}`, tag: 'lark_md' } },
    { is_short: true, text: { content: `**ROI**\n${roi}`, tag: 'lark_md' } },
  ]

  if (action.currentBudget && action.newBudget) {
    fields.push({ is_short: true, text: { content: `**预算**\n$${action.currentBudget} → $${action.newBudget}`, tag: 'lark_md' } })
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: action.type === 'pause' ? 'orange' : 'blue',
      title: { content: `AutoArk 待审批: ${actionLabel} ${name}`, tag: 'plain_text' },
    },
    elements: [
      { tag: 'div', fields },
      { tag: 'div', text: { content: `**决策依据**\n${action.reason || '-'}`, tag: 'lark_md' } },
      ...(action.skillName ? [{ tag: 'note' as const, elements: [{ tag: 'plain_text' as const, content: `Skill: ${action.skillName} | 大盘 P25=${benchmarks.p25Roi} P50=${benchmarks.medianRoi} P75=${benchmarks.p75Roi}` }] }] : []),
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { content: '通过', tag: 'plain_text' },
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
