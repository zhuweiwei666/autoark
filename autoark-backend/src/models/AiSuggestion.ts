import mongoose, { Schema, Document } from 'mongoose'

/**
 * 🤖 AI 优化建议
 * 
 * AI 分析后生成的可执行操作建议
 * 用户可以审批后一键执行
 */

export type SuggestionType = 
  | 'pause_ad'           // 暂停广告
  | 'pause_adset'        // 暂停广告组
  | 'pause_campaign'     // 暂停广告系列
  | 'enable_ad'          // 启用广告
  | 'budget_increase'    // 增加预算
  | 'budget_decrease'    // 降低预算
  | 'bid_adjust'         // 调整出价
  | 'targeting_adjust'   // 调整定向
  | 'creative_replace'   // 更换素材
  | 'scale_up'           // 扩量复制
  | 'alert'              // 仅预警

export type SuggestionPriority = 'high' | 'medium' | 'low'
export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired'

export interface IAiSuggestion extends Document {
  // 建议类型
  type: SuggestionType
  priority: SuggestionPriority
  
  // 目标实体
  entityType: 'campaign' | 'adset' | 'ad' | 'material'
  entityId: string
  entityName: string
  accountId: string
  
  // 建议内容
  title: string           // 简短标题
  description: string     // 详细描述
  reason: string          // AI 给出的理由
  
  // 当前状态
  currentMetrics: {
    roas?: number
    spend?: number
    ctr?: number
    cpm?: number
    impressions?: number
  }
  
  // 建议操作
  action: {
    type: SuggestionType
    params?: {
      newStatus?: string
      budgetChange?: number
      budgetChangePercent?: number
      newBudget?: number
      bidAmount?: number
      targetingChanges?: any
    }
  }
  
  // 预期效果
  expectedImpact?: string
  
  // 状态
  status: SuggestionStatus
  
  // 执行结果
  execution?: {
    executedAt?: Date
    executedBy?: string
    success?: boolean
    error?: string
    result?: any
  }
  
  // 过期时间（建议的有效期）
  expiresAt: Date
  
  // 来源
  source: 'auto_analysis' | 'chat' | 'health_check' | 'rule_suggestion'
  sourceId?: string  // 关联的对话 ID 或规则 ID
  
  // 元信息
  createdAt: Date
  updatedAt: Date
}

const aiSuggestionSchema = new Schema({
  type: { 
    type: String, 
    enum: ['pause_ad', 'pause_adset', 'pause_campaign', 'enable_ad', 
           'budget_increase', 'budget_decrease', 'bid_adjust', 
           'targeting_adjust', 'creative_replace', 'scale_up', 'alert'],
    required: true 
  },
  priority: { 
    type: String, 
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  
  entityType: { 
    type: String, 
    enum: ['campaign', 'adset', 'ad', 'material'],
    required: true 
  },
  entityId: { type: String, required: true },
  entityName: { type: String },
  accountId: { type: String, required: true },
  
  title: { type: String, required: true },
  description: { type: String },
  reason: { type: String },
  
  currentMetrics: {
    roas: { type: Number },
    spend: { type: Number },
    ctr: { type: Number },
    cpm: { type: Number },
    impressions: { type: Number },
  },
  
  action: {
    type: { type: String, required: true },
    params: { type: Schema.Types.Mixed },
  },
  
  expectedImpact: { type: String },
  
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'executed', 'failed', 'expired'],
    default: 'pending'
  },
  
  execution: {
    executedAt: { type: Date },
    executedBy: { type: String },
    success: { type: Boolean },
    error: { type: String },
    result: { type: Schema.Types.Mixed },
  },
  
  expiresAt: { 
    type: Date, 
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000)  // 默认 24 小时后过期
  },
  
  source: { 
    type: String, 
    enum: ['auto_analysis', 'chat', 'health_check', 'rule_suggestion'],
    default: 'auto_analysis'
  },
  sourceId: { type: String },
}, { 
  timestamps: true,
  collection: 'aisuggestions'
})

// 索引
aiSuggestionSchema.index({ status: 1, priority: -1 })
aiSuggestionSchema.index({ entityId: 1, entityType: 1 })
aiSuggestionSchema.index({ accountId: 1 })
aiSuggestionSchema.index({ expiresAt: 1 })
aiSuggestionSchema.index({ createdAt: -1 })

export const AiSuggestion = mongoose.model<IAiSuggestion>('AiSuggestion', aiSuggestionSchema)
export default AiSuggestion
