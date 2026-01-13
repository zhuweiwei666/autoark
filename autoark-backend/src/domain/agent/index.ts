/**
 * Agent 领域模块入口
 * 
 * 该模块负责 AI Agent 的配置管理、自动化执行、报告生成等功能
 * 
 * 架构说明：
 * - agent.service.ts: 主服务（facade），保持向后兼容
 * - agent.model.ts: 数据模型定义
 * - agent.controller.ts: HTTP 控制器
 * 
 * 子模块（已拆分）：
 * - health/: 账户健康度分析
 * - alert/: 告警通知服务
 * - approval/: 操作审批流程
 * - analytics/: 趋势分析和评分服务
 * - executor/: 操作执行和动量控制
 * 
 * 待拆分：
 * - report/: 智能报告生成
 * - chat/: AI 对话问答
 * - creative/: 素材 AI 评分
 * - automation/: 自动化执行逻辑
 */

// 主服务
export { agentService } from './agent.service'

// 数据模型
export { AgentConfig, AgentOperation, DailyReport, AiConversation, CreativeScore } from './agent.model'

// 子服务
export { healthService } from './health/health.service'
export { alertService } from './alert/alert.service'
export { approvalService } from './approval/approval.service'
export { scoringService } from './analytics/scoring.service'
export { trendService } from './analytics/trend.service'
export { momentumService } from './executor/momentum.service'
