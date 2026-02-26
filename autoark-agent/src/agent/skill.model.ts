/**
 * 统一 Skill 数据模型（V2）
 *
 * Skills = Agent 的进化记忆，分三种类型：
 * - experience: 自然语言经验（场景-结果-教训），给 LLM 做 context
 * - goal: 目标约束（产品维度的硬约束），给 A4 全局治理
 * - meta: 元规则（衰减/提权/清理策略），给 A5
 * - config: 基础配置（数据源/优化师范围等），给 A1
 * - rule: 旧版条件规则（向后兼容）
 *
 * 核心原则：Skills 告诉 Agent "过去发生过什么" 和 "什么不能做"，
 * 而不是告诉它 "该做什么"。决策由 LLM 推理产出。
 */
import mongoose from 'mongoose'

// ==================== Schema ====================

const conditionSchema = new mongoose.Schema({
  field: { type: String, required: true },
  operator: { type: String, enum: ['>', '<', '>=', '<=', '==', '!='], required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { _id: false })

const skillSchema = new mongoose.Schema({
  name: { type: String, required: true },
  agentId: { type: String, required: true },
  description: { type: String, default: '' },

  // ========== V2: Skill 类型 ==========
  skillType: {
    type: String,
    enum: ['experience', 'goal', 'meta', 'config', 'rule'],
    default: 'rule',
  },

  // ========== V2: 自然语言经验体系 ==========
  experience: {
    scenario: { type: String, default: '' },
    outcome: { type: String, default: '' },
    lesson: { type: String, default: '' },
    confidence: { type: Number, default: 0.5 },
    validatedCount: { type: Number, default: 0 },
    lastValidatedAt: { type: Date },
    source: { type: String, enum: ['human', 'a5_auto', 'reflection'], default: 'human' },
  },

  // ========== V2: 目标约束（A4 用）==========
  goal: {
    product: { type: String, default: '' },
    dailySpendTarget: { type: Number, default: 0 },
    roasFloor: { type: Number, default: 0 },
    priority: { type: String, enum: ['roas_first', 'spend_first', 'balanced'], default: 'roas_first' },
    channels: { type: [String], default: [] },
    countries: { type: [String], default: [] },
    notes: { type: String, default: '' },
  },

  // ========== V2: 基础配置（A1 用）==========
  config: {
    key: { type: String, default: '' },
    value: { type: mongoose.Schema.Types.Mixed },
  },

  // ========== 旧版兼容 ==========
  match: {
    packagePatterns: { type: [String], default: [] },
    platforms: { type: [String], default: [] },
    optimizers: { type: [String], default: [] },
    accountIds: { type: [String], default: [] },
  },
  screening: {
    conditions: { type: [conditionSchema], default: [] },
    conditionLogic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
    verdict: { type: String, enum: ['needs_decision', 'watch', 'skip'] },
    priority: { type: String, enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
    reasonTemplate: { type: String, default: '' },
    historyCheck: {
      enabled: { type: Boolean, default: false },
      field: { type: String, default: 'adjustedRoi' },
      windowDays: { type: Number, default: 7 },
      deviationStddev: { type: Number, default: 2 },
    },
  },
  decision: {
    triggerLabels: { type: [String], default: [] },
    conditions: { type: [conditionSchema], default: [] },
    conditionLogic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
    action: { type: String, enum: ['pause', 'increase_budget', 'decrease_budget', 'resume'] },
    auto: { type: Boolean, default: false },
    params: {
      budgetChangePct: { type: Number, default: 0 },
    },
    reasonTemplate: { type: String, default: '' },
    llmContext: { type: String, default: '' },
    llmRules: { type: [String], default: [] },
  },

  // ========== 通用 ==========
  enabled: { type: Boolean, default: true },
  order: { type: Number, default: 100 },
  proposedBy: { type: String, enum: ['human', 'librarian', 'a5_auto'], default: 'human' },
  stats: {
    triggered: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    lastTriggeredAt: { type: Date },
  },
  learnedNotes: { type: [String], default: [] },
  rollback: {
    version: { type: Number, default: 1 },
    lastRollbackAt: { type: Date },
    rollbackReason: { type: String, default: '' },
  },
}, { timestamps: true })

skillSchema.index({ agentId: 1, enabled: 1, order: 1 })

export const Skill = mongoose.model('AgentSkill', skillSchema)

// ==================== 类型 ====================

export interface SkillCondition {
  field: string
  operator: '>' | '<' | '>=' | '<=' | '==' | '!='
  value: number | string
}

export interface ScreeningSkillData {
  conditions: SkillCondition[]
  conditionLogic: 'AND' | 'OR'
  verdict: 'needs_decision' | 'watch' | 'skip'
  priority: 'critical' | 'high' | 'normal' | 'low'
  reasonTemplate: string
  historyCheck?: {
    enabled: boolean
    field: string
    windowDays: number
    deviationStddev: number
  }
}

export interface DecisionSkillData {
  triggerLabels: string[]
  conditions: SkillCondition[]
  conditionLogic: 'AND' | 'OR'
  action: 'pause' | 'increase_budget' | 'decrease_budget' | 'resume'
  auto: boolean
  params: { budgetChangePct: number }
  reasonTemplate: string
  llmContext: string
  llmRules: string[]
}

export interface AgentSkillDoc {
  _id: any
  name: string
  agentId: 'screener' | 'decision' | 'executor' | 'auditor' | 'data_fusion'
  description: string
  match: {
    packagePatterns: string[]
    platforms: string[]
    optimizers: string[]
    accountIds: string[]
  }
  screening: ScreeningSkillData
  decision: DecisionSkillData
  enabled: boolean
  order: number
  proposedBy: 'human' | 'librarian'
  stats: { triggered: number; correct: number; wrong: number; accuracy: number; lastTriggeredAt?: Date }
  learnedNotes: string[]
}

// ==================== 匹配工具 ====================

/**
 * 判断 campaign 是否符合 Skill 的 match 条件（包名/平台/优化师/账户）。
 * 空数组表示"不限"。
 */
export function matchesCampaign(
  skill: AgentSkillDoc,
  campaign: { pkgName?: string; platform?: string; optimizer?: string; accountId?: string },
): boolean {
  const m = skill.match
  if (!m) return true

  if (m.packagePatterns?.length > 0 && campaign.pkgName) {
    const hit = m.packagePatterns.some(p => {
      const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$', 'i')
      return regex.test(campaign.pkgName!)
    })
    if (!hit) return false
  }

  if (m.platforms?.length > 0 && campaign.platform) {
    if (!m.platforms.some(p => campaign.platform!.toLowerCase().includes(p.toLowerCase()))) return false
  }

  if (m.optimizers?.length > 0 && campaign.optimizer) {
    if (!m.optimizers.includes(campaign.optimizer)) return false
  }

  if (m.accountIds?.length > 0 && campaign.accountId) {
    if (!m.accountIds.includes(campaign.accountId)) return false
  }

  return true
}

/**
 * 评估一组条件是否满足
 */
export function evaluateConditions(
  conditions: SkillCondition[],
  logic: 'AND' | 'OR',
  data: Record<string, any>,
): boolean {
  if (conditions.length === 0) return false

  const check = (c: SkillCondition): boolean => {
    const val = data[c.field]
    if (val === undefined || val === null) return false
    switch (c.operator) {
      case '>': return val > c.value
      case '<': return val < c.value
      case '>=': return val >= c.value
      case '<=': return val <= c.value
      case '==': return val == c.value
      case '!=': return val != c.value
      default: return false
    }
  }

  return logic === 'AND'
    ? conditions.every(check)
    : conditions.some(check)
}

/**
 * 用 campaign 数据填充 reasonTemplate 中的占位符
 * 模板示例: "ROAS {adjustedRoi} 低于止损线，花费 ${todaySpend}"
 */
export function fillReasonTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = data[key]
    if (v === undefined || v === null) return `{${key}}`
    return typeof v === 'number' ? v.toFixed(2) : String(v)
  })
}
