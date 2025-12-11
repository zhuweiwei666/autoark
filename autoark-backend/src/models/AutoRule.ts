import mongoose, { Schema, Document } from 'mongoose'

/**
 * 🤖 自动化规则引擎
 * 
 * 支持的规则类型：
 * 1. 自动关停：ROAS 过低的广告/广告组/广告系列
 * 2. 自动扩量：ROAS 高的自动提升预算
 * 3. 预警通知：满足条件时发送通知
 * 4. 自动测试：新素材自动创建测试广告
 */

// ==================== 类型定义 ====================

export type RuleType = 
  | 'auto_pause'      // 自动暂停
  | 'auto_enable'     // 自动启用
  | 'budget_up'       // 提升预算
  | 'budget_down'     // 降低预算
  | 'alert'           // 预警通知
  | 'auto_test'       // 自动测试

export type EntityLevel = 'campaign' | 'adset' | 'ad'

export type MetricType = 
  | 'roas' 
  | 'spend' 
  | 'ctr' 
  | 'cpm' 
  | 'cpc'
  | 'impressions'
  | 'clicks'
  | 'installs'
  | 'purchases'

export type ConditionOperator = 
  | 'gt'      // 大于
  | 'gte'     // 大于等于
  | 'lt'      // 小于
  | 'lte'     // 小于等于
  | 'eq'      // 等于
  | 'between' // 区间

export type TimeRange = 'today' | 'yesterday' | 'last_3_days' | 'last_7_days' | 'lifetime'

export type ScheduleType = 'hourly' | 'daily' | 'custom'

// ==================== 接口定义 ====================

export interface ICondition {
  metric: MetricType
  operator: ConditionOperator
  value: number
  value2?: number  // 用于 between 操作符
  timeRange: TimeRange
}

export interface IAction {
  type: RuleType
  // 预算调整相关
  budgetChange?: number       // 预算变化金额（正数增加，负数减少）
  budgetChangePercent?: number // 预算变化百分比
  maxBudget?: number          // 最大预算限制
  minBudget?: number          // 最小预算限制
  // 通知相关
  notifyWebhook?: string      // Webhook URL
  notifyEmail?: string        // 邮件地址
}

export interface IRuleExecution {
  executedAt: Date
  entitiesChecked: number
  entitiesAffected: number
  details: Array<{
    entityId: string
    entityName: string
    action: string
    oldValue?: any
    newValue?: any
    success: boolean
    error?: string
  }>
}

export interface IAutoRule extends Document {
  name: string
  description?: string
  
  // 规则范围
  entityLevel: EntityLevel
  accountIds?: string[]       // 限定账户，空表示所有
  campaignIds?: string[]      // 限定广告系列
  
  // 触发条件（所有条件需满足 - AND 逻辑）
  conditions: ICondition[]
  
  // 执行动作
  action: IAction
  
  // 调度配置
  schedule: {
    type: ScheduleType
    cron?: string             // 自定义 cron 表达式
    timezone?: string
  }
  
  // 安全限制
  limits: {
    maxExecutionsPerDay?: number      // 每天最多执行次数
    maxEntitiesPerExecution?: number  // 每次最多影响实体数
    cooldownMinutes?: number          // 同一实体冷却时间
    requireApproval?: boolean         // 是否需要人工审批
  }
  
  // 状态
  status: 'active' | 'paused' | 'draft'
  
  // 统计
  stats: {
    totalExecutions: number
    lastExecutedAt?: Date
    totalEntitiesAffected: number
  }
  
  // 执行历史（最近 100 条）
  executions: IRuleExecution[]
  
  // 元信息
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

// ==================== Schema 定义 ====================

const conditionSchema = new Schema({
  metric: { 
    type: String, 
    enum: ['roas', 'spend', 'ctr', 'cpm', 'cpc', 'impressions', 'clicks', 'installs', 'purchases'],
    required: true 
  },
  operator: { 
    type: String, 
    enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'between'],
    required: true 
  },
  value: { type: Number, required: true },
  value2: { type: Number },
  timeRange: { 
    type: String, 
    enum: ['today', 'yesterday', 'last_3_days', 'last_7_days', 'lifetime'],
    default: 'last_3_days'
  },
}, { _id: false })

const actionSchema = new Schema({
  type: { 
    type: String, 
    enum: ['auto_pause', 'auto_enable', 'budget_up', 'budget_down', 'alert', 'auto_test'],
    required: true 
  },
  budgetChange: { type: Number },
  budgetChangePercent: { type: Number },
  maxBudget: { type: Number },
  minBudget: { type: Number },
  notifyWebhook: { type: String },
  notifyEmail: { type: String },
}, { _id: false })

const executionDetailSchema = new Schema({
  entityId: { type: String, required: true },
  entityName: { type: String },
  action: { type: String, required: true },
  oldValue: { type: Schema.Types.Mixed },
  newValue: { type: Schema.Types.Mixed },
  success: { type: Boolean, required: true },
  error: { type: String },
}, { _id: false })

const executionSchema = new Schema({
  executedAt: { type: Date, default: Date.now },
  entitiesChecked: { type: Number, default: 0 },
  entitiesAffected: { type: Number, default: 0 },
  details: [executionDetailSchema],
}, { _id: false })

const autoRuleSchema = new Schema({
  name: { type: String, required: true },
  description: { type: String },
  
  entityLevel: { 
    type: String, 
    enum: ['campaign', 'adset', 'ad'],
    required: true 
  },
  accountIds: [{ type: String }],
  campaignIds: [{ type: String }],
  
  conditions: { type: [conditionSchema], required: true },
  action: { type: actionSchema, required: true },
  
  schedule: {
    type: { 
      type: String, 
      enum: ['hourly', 'daily', 'custom'],
      default: 'hourly'
    },
    cron: { type: String },
    timezone: { type: String, default: 'Asia/Shanghai' },
  },
  
  limits: {
    maxExecutionsPerDay: { type: Number, default: 24 },
    maxEntitiesPerExecution: { type: Number, default: 50 },
    cooldownMinutes: { type: Number, default: 60 },
    requireApproval: { type: Boolean, default: false },
  },
  
  status: { 
    type: String, 
    enum: ['active', 'paused', 'draft'],
    default: 'draft'
  },
  
  stats: {
    totalExecutions: { type: Number, default: 0 },
    lastExecutedAt: { type: Date },
    totalEntitiesAffected: { type: Number, default: 0 },
  },
  
  executions: { 
    type: [executionSchema],
    default: [],
    // 只保留最近 100 条
    validate: [(val: any[]) => val.length <= 100, 'Executions limit exceeded']
  },
  
  createdBy: { type: String, required: true },
}, { 
  timestamps: true,
  collection: 'autorules'
})

// 索引
autoRuleSchema.index({ status: 1 })
autoRuleSchema.index({ 'schedule.type': 1 })
autoRuleSchema.index({ createdBy: 1 })

export const AutoRule = mongoose.model<IAutoRule>('AutoRule', autoRuleSchema)
export default AutoRule
