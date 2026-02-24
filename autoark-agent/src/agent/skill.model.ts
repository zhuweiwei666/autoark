/**
 * 统一 Skill 数据模型
 *
 * 每个 Agent（screener / decision / executor / auditor）拥有独立的 Skill 库。
 * 一条规则 = 一个 Skill，存 MongoDB，前端可编辑、可开关、可排序、可追溯效果。
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
  agentId: { type: String, enum: ['screener', 'decision', 'executor', 'auditor'], required: true },
  description: { type: String, default: '' },

  // ========== 匹配条件：哪些 campaign 适用此 Skill ==========
  match: {
    packagePatterns: { type: [String], default: [] },
    platforms: { type: [String], default: [] },
    optimizers: { type: [String], default: [] },
    accountIds: { type: [String], default: [] },
  },

  // ========== Screener Skill 专属 ==========
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

  // ========== Decision Skill 专属 ==========
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
  proposedBy: { type: String, enum: ['human', 'librarian'], default: 'human' },
  stats: {
    triggered: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    lastTriggeredAt: { type: Date },
  },
  learnedNotes: { type: [String], default: [] },
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
  agentId: 'screener' | 'decision' | 'executor' | 'auditor'
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
