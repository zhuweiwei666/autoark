/**
 * Stage 5: 多 Agent 协作
 * 
 * 四个专业 Agent，各司其职：
 * - Monitor Agent: 持续感知数据变化，检测异常
 * - Strategy Agent: 加载 Skill，分析数据，生成操作建议
 * - Executor Agent: 执行已审批的操作，带重试和验证
 * - Auditor Agent: 回顾决策效果，更新经验，生成报告
 * 
 * 目前整合在 brain.ts 里，这个文件定义了多 Agent 架构的接口，
 * 未来可以拆分为独立进程/服务。
 */
import { AgentEvent, getEventPriority } from './events'

// ==================== Agent 角色定义 ====================

export type AgentRole = 'monitor' | 'strategy' | 'executor' | 'auditor'

export interface AgentMessage {
  from: AgentRole
  to: AgentRole
  type: string
  payload: any
  timestamp: Date
}

// ==================== 路由规则 ====================

/**
 * 根据用户消息内容判断应该路由到哪个 Agent
 */
export function routeUserMessage(message: string): AgentRole {
  const lower = message.toLowerCase()

  // 执行类
  if (/暂停|关停|关掉|停掉|pause|stop/.test(lower)) return 'executor'
  if (/恢复|开启|打开|激活|启动|resume|activate/.test(lower)) return 'executor'
  if (/加预算|提预算|increase.*budget/.test(lower)) return 'executor'

  // 审计类
  if (/效果|准确率|上周|回顾|复盘|report|review/.test(lower)) return 'auditor'
  if (/学到|经验|lesson|学习/.test(lower)) return 'auditor'

  // 监控类
  if (/今天|实时|当前|status|数据/.test(lower)) return 'monitor'
  if (/异常|告警|alert/.test(lower)) return 'monitor'

  // 默认：策略分析
  return 'strategy'
}

/**
 * 根据事件类型判断应该由哪个 Agent 处理
 */
export function routeEvent(event: AgentEvent): AgentRole {
  const priority = getEventPriority(event)

  if (event.type === 'reflection_due') return 'auditor'
  if (event.type === 'approval_received') return 'executor'
  if (event.type === 'user_command') return routeUserMessage((event as any).command)

  // 紧急事件 → 直接到策略（需要快速决策）
  if (priority === 'critical' || priority === 'high') return 'strategy'

  // 常规事件 → 监控先看，再决定要不要转策略
  return 'monitor'
}

/**
 * Agent 角色的 System Prompt 前缀
 */
export const AGENT_PROMPTS: Record<AgentRole, string> = {
  monitor: `你是监控 Agent，负责持续观察广告数据变化。
你的职责：
- 汇报当前数据概况（花费、ROAS、异常）
- 检测到异常时清晰描述问题
- 不做决策，只报告事实`,

  strategy: `你是策略 Agent，负责分析数据并给出操作建议。
你的职责：
- 根据数据和 Skill 规则，判断每个 campaign 该怎么处理
- 给出具体的操作建议（暂停/加预算/观察）
- 每个建议必须说明原因`,

  executor: `你是执行 Agent，负责执行已审批的操作。
你的职责：
- 确认操作参数正确
- 执行操作（调用 TopTou API）
- 报告执行结果`,

  auditor: `你是审计 Agent，负责回顾决策效果和积累经验。
你的职责：
- 分析过去决策的效果（正确/错误/不确定）
- 提取经验教训
- 生成改进建议
- 生成定期报告`,
}
