/**
 * Agent 独立配置模型
 * 每个 Agent（监控/策略/执行/审计）有自己的配置，存 MongoDB，前端可编辑
 */
import mongoose from 'mongoose'

const agentConfigSchema = new mongoose.Schema({
  agentId: { type: String, required: true, unique: true }, // 'monitor' | 'strategy' | 'executor' | 'auditor'

  // ==================== 监控 Agent 配置 ====================
  monitor: {
    // Metabase 数据源配置
    dataSources: [{
      name: String,            // "Campaign 聚合报表"
      cardId: String,          // Metabase question ID: "7726"
      accessCode: String,      // "xheqmmolkpj9f35e"
      description: String,     // 描述
      role: String,            // "combined" (新) | "spend" | "conversion" (旧兼容)
      enabled: { type: Boolean, default: true },
    }],
    // 扫描频率
    scanIntervalMinutes: { type: Number, default: 10 },
    // 事件检测阈值
    eventThresholds: {
      spendSpikeRatio: { type: Number, default: 2 },      // 花费飙升倍数
      roasCrashDropPct: { type: Number, default: 50 },     // ROAS 暴跌百分比
      zeroConversionMinSpend: { type: Number, default: 50 }, // 零转化最低花费
    },
  },

  // ==================== 策略 Agent 配置 ====================
  strategy: {
    // 投放目标
    objectives: {
      targetRoas: { type: Number, default: 1.5 },
      maxCpa: Number,
      dailyBudgetLimit: Number,
    },
    // 决策标准覆盖
    thresholds: {
      observe_max_spend: Number,
      loss_severe_roas: Number,
      loss_severe_min_spend: Number,
      loss_mild_roas: Number,
      high_potential_roas: Number,
    },
    // 活跃的 Skill 列表（引用）
    activeSkillIds: [String],
    // 额外决策规则（自然语言，注入 LLM prompt）
    customRules: [String],
  },

  // ==================== 执行 Agent 配置 ====================
  executor: {
    // 权责范围
    scope: {
      accountIds: [String],
      packageNames: [String],
      optimizers: [String],
    },
    // 操作权限：哪些操作需要审批，哪些可以自动执行
    permissions: {
      pause_severe_loss: { type: String, enum: ['auto', 'approve'], default: 'approve' },
      pause_mild_loss: { type: String, enum: ['auto', 'approve'], default: 'approve' },
      pause_zero_conversion: { type: String, enum: ['auto', 'approve'], default: 'approve' },
      increase_budget: { type: String, enum: ['auto', 'approve'], default: 'approve' },
      decrease_budget: { type: String, enum: ['auto', 'approve'], default: 'approve' },
      resume: { type: String, enum: ['auto', 'approve'], default: 'approve' },
    },
    // 执行限制
    limits: {
      maxBudgetChangePct: { type: Number, default: 30 },
      maxDailyBudget: { type: Number, default: 500 },
      cooldownHours: { type: Number, default: 24 },
      maxActionsPerRun: { type: Number, default: 50 },
    },
  },

  // ==================== 审计 Agent 配置 ====================
  auditor: {
    // 反思时机
    reflectionDelayHours: { type: Number, default: 2 },   // 执行后多久反思
    reflectionWindowHours: { type: Number, default: 24 },  // 反思窗口
    // 进化配置
    evolutionEnabled: { type: Boolean, default: true },
    evolutionSchedule: { type: String, default: 'weekly' }, // weekly | daily
    // 经验沉淀规则
    lessonRules: [String],  // 自然语言规则："如果关停后ROAS反弹，说明判断太早"
    // 工作流控制
    workflowControl: {
      pauseOnLowAccuracy: { type: Boolean, default: false }, // 准确率低于阈值时暂停 Agent
      pauseAccuracyThreshold: { type: Number, default: 50 }, // %
      maxConsecutiveErrors: { type: Number, default: 5 },    // 连续错误次数
    },
  },

  // ==================== 通用配置 ====================
  // 上下文（每个 Agent 的 System Prompt 补充）
  customContext: String,
  // 是否启用
  enabled: { type: Boolean, default: true },

}, { timestamps: true })

export const AgentConfig = mongoose.model('AgentConfig2', agentConfigSchema)

// 默认配置
export const DEFAULT_CONFIGS: Record<string, any> = {
  monitor: {
    agentId: 'monitor',
    monitor: {
      dataSources: [
        { name: 'Campaign 聚合报表（V6）', cardId: '7726', accessCode: 'xheqmmolkpj9f35e', description: '花费(API)、安装量、CPI、CPA、收入、首日ROI、调整ROI、三日ROI、付费率、ARPU', role: 'combined', enabled: true },
      ],
      scanIntervalMinutes: 10,
      eventThresholds: { spendSpikeRatio: 2, roasCrashDropPct: 50, zeroConversionMinSpend: 50 },
    },
    enabled: true,
  },
  strategy: {
    agentId: 'strategy',
    strategy: {
      objectives: { targetRoas: 1.5 },
      thresholds: {},
      activeSkillIds: [],
      customRules: [],
    },
    enabled: true,
  },
  executor: {
    agentId: 'executor',
    executor: {
      scope: { accountIds: [], packageNames: [], optimizers: [] },
      permissions: {
        pause_severe_loss: 'approve',
        pause_mild_loss: 'approve',
        pause_zero_conversion: 'approve',
        increase_budget: 'approve',
        decrease_budget: 'approve',
        resume: 'approve',
      },
      limits: { maxBudgetChangePct: 30, maxDailyBudget: 500, cooldownHours: 24, maxActionsPerRun: 50 },
    },
    enabled: true,
  },
  auditor: {
    agentId: 'auditor',
    auditor: {
      reflectionDelayHours: 2,
      reflectionWindowHours: 24,
      evolutionEnabled: true,
      evolutionSchedule: 'weekly',
      lessonRules: ['如果关停后同类 campaign ROAS 反弹，说明判断太早，应延长观察期', '如果加预算后 ROAS 下降超 30%，说明到了扩量瓶颈'],
      workflowControl: { pauseOnLowAccuracy: false, pauseAccuracyThreshold: 50, maxConsecutiveErrors: 5 },
    },
    enabled: true,
  },
  feishu: {
    agentId: 'feishu',
    feishu: {
      enabled: true,
      appId: 'cli_a9c0a78e8a385ccd',
      appSecret: '1Xcpc1LTr3C7Zh1KJHVpdgWh7FNcYRJl',
      receiveId: 'oc_f249fe67a3c7a316d818f95510d0f43a',
      receiveIdType: 'chat_id',
      notifications: {
        cycleSummary: true,
        approvalCard: true,
        urgentAlert: true,
        onlyWhenActions: false,
      },
    },
    enabled: true,
  },
}

/**
 * 获取 Agent 配置（直接读 raw collection，避免 Mongoose schema 过滤）
 */
export async function getAgentConfig(agentId: string): Promise<any> {
  const db = mongoose.connection.db
  if (!db) return DEFAULT_CONFIGS[agentId] || null
  let config = await db.collection('agentconfig2s').findOne({ agentId })
  if (!config && DEFAULT_CONFIGS[agentId]) {
    await db.collection('agentconfig2s').insertOne({ ...DEFAULT_CONFIGS[agentId], createdAt: new Date(), updatedAt: new Date() })
    config = await db.collection('agentconfig2s').findOne({ agentId })
  }
  return config
}

/**
 * 更新 Agent 配置（直接写 raw collection）
 */
export async function updateAgentConfig(agentId: string, updates: any): Promise<any> {
  const db = mongoose.connection.db
  if (!db) return null
  await db.collection('agentconfig2s').updateOne(
    { agentId },
    { $set: { ...updates, updatedAt: new Date() } },
    { upsert: true }
  )
  return db.collection('agentconfig2s').findOne({ agentId })
}
