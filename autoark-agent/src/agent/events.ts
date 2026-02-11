/**
 * 事件系统 - Agent 的神经信号
 * 所有模块通过事件通信，不直接耦合
 */

export type AgentEvent =
  | { type: 'spend_spike'; campaignId: string; campaignName: string; accountId: string; currentRate: number; normalRate: number; ratio: number }
  | { type: 'roas_crash'; campaignId: string; campaignName: string; accountId: string; before: number; after: number; dropPct: number }
  | { type: 'zero_conversion'; campaignId: string; campaignName: string; accountId: string; spend: number; hours: number }
  | { type: 'new_campaign'; campaignId: string; campaignName: string; accountId: string; ageHours: number }
  | { type: 'budget_exhausting'; campaignId: string; campaignName: string; accountId: string; remainPct: number }
  | { type: 'performance_recovered'; campaignId: string; campaignName: string; roasBefore: number; roasNow: number }
  | { type: 'scheduled_review'; interval: string }
  | { type: 'reflection_due'; decisionId: string; campaignId: string; hoursAgo: number }
  | { type: 'user_command'; command: string; userId: string }
  | { type: 'approval_received'; actionId: string; approved: boolean }

export type EventPriority = 'critical' | 'high' | 'normal' | 'low'

export function getEventPriority(event: AgentEvent): EventPriority {
  switch (event.type) {
    case 'spend_spike': return 'critical'
    case 'roas_crash': return 'critical'
    case 'zero_conversion': return 'high'
    case 'budget_exhausting': return 'high'
    case 'reflection_due': return 'normal'
    case 'scheduled_review': return 'normal'
    case 'new_campaign': return 'low'
    case 'performance_recovered': return 'low'
    default: return 'normal'
  }
}

export function describeEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'spend_spike': return `花费飙升: ${event.campaignName} 当前速率 $${event.currentRate}/h，正常 $${event.normalRate}/h (${event.ratio}x)`
    case 'roas_crash': return `ROAS 暴跌: ${event.campaignName} 从 ${event.before} 跌到 ${event.after} (-${event.dropPct}%)`
    case 'zero_conversion': return `零转化: ${event.campaignName} 已花费 $${event.spend}，${event.hours}h 无转化`
    case 'new_campaign': return `新 campaign: ${event.campaignName} 开投 ${event.ageHours}h`
    case 'budget_exhausting': return `预算告急: ${event.campaignName} 剩余 ${event.remainPct}%`
    case 'performance_recovered': return `效果恢复: ${event.campaignName} ROAS ${event.roasBefore} → ${event.roasNow}`
    case 'scheduled_review': return `定时检查 (${event.interval})`
    case 'reflection_due': return `待复盘: campaign ${event.campaignId}，${event.hoursAgo}h 前操作`
    case 'user_command': return `用户指令: ${event.command}`
    case 'approval_received': return `审批结果: ${event.actionId} ${event.approved ? '通过' : '拒绝'}`
  }
}

/** 简单的事件总线 */
type EventHandler = (event: AgentEvent) => Promise<void>
const handlers: EventHandler[] = []

export function onEvent(handler: EventHandler) { handlers.push(handler) }

export async function emitEvent(event: AgentEvent) {
  for (const handler of handlers) {
    try { await handler(event) } catch (e: any) { /* don't let one handler break others */ }
  }
}
