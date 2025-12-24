import mongoose from 'mongoose'

/**
 * AI Agent 配置模型
 * 定义 Agent 的策略、规则和行为
 */
const agentConfigSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  
  // 归属组织（用于隔离；为空表示全局/仅依赖 accountIds）
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },

  // 关联的账户 (空表示应用于所有账户) - 兼容旧字段
  accountIds: [{ type: String }],

  /**
   * RBAC / 资产池范围（你描述的“把账户池分配给 AI”）
   * - adAccountIds：AI 可操作的广告账户（最小授权单元）
   * - fbTokenIds：AI 可使用哪些 token 执行（可为空：按 organizationId 自动选择）
   * - facebookAppIds：AI 允许绑定/使用哪些 App（可为空：按系统可用池）
   * - materials/targeting/copywriting：AI 在 AutoArk 内部可用的素材/定向包/文案包范围
   */
  scope: {
    adAccountIds: [{ type: String }], // account_id（不带 act_）
    fbTokenIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FbToken' }],
    tiktokTokenIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TiktokToken' }],
    facebookAppIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FacebookApp' }],

    materials: {
      allowAll: { type: Boolean, default: true },
      folderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Folder' }],
      materialIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Material' }],
    },

    targetingPackages: {
      allowAll: { type: Boolean, default: true },
      allowCreate: { type: Boolean, default: false },
      packageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TargetingPackage' }],
    },

    copywritingPackages: {
      allowAll: { type: Boolean, default: true },
      allowCreate: { type: Boolean, default: false },
      packageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CopywritingPackage' }],
    },
  },

  /**
   * AI 能做哪些动作（全自动化必须有边界）
   */
  permissions: {
    canPublishAds: { type: Boolean, default: true },
    canToggleStatus: { type: Boolean, default: true },
    canAdjustBudget: { type: Boolean, default: true },
    canAdjustBid: { type: Boolean, default: false },
    canPause: { type: Boolean, default: true },
    canResume: { type: Boolean, default: true },
  },
  
  // Agent 状态
  status: {
    type: String,
    enum: ['active', 'paused', 'disabled'],
    default: 'paused',
  },
  
  // 运行模式
  mode: {
    type: String,
    enum: ['observe', 'suggest', 'auto'],  // 观察/建议/自动执行
    default: 'observe',
  },
  
  // 策略目标
  objectives: {
    targetRoas: { type: Number, default: 1.5 },
    maxCpa: { type: Number },
    dailyBudgetLimit: { type: Number },
    monthlyBudgetLimit: { type: Number },
  },
  
  // 规则配置
  rules: {
    // 自动关停规则
    autoStop: {
      enabled: { type: Boolean, default: true },
      roasThreshold: { type: Number, default: 0.5 },  // ROAS < 0.5
      minDays: { type: Number, default: 3 },          // 连续 3 天
      minSpend: { type: Number, default: 50 },        // 最小消耗 $50
    },
    
    // 自动扩量规则
    autoScale: {
      enabled: { type: Boolean, default: true },
      roasThreshold: { type: Number, default: 2.0 },  // ROAS > 2.0
      minDays: { type: Number, default: 3 },          // 连续 3 天
      budgetIncrease: { type: Number, default: 0.2 }, // 增加 20%
      maxBudget: { type: Number },                    // 最大预算上限
    },
    
    // 预算调整规则
    budgetAdjust: {
      enabled: { type: Boolean, default: true },
      minAdjustPercent: { type: Number, default: 0.1 },   // 最小调整 10%
      maxAdjustPercent: { type: Number, default: 0.3 },   // 最大调整 30%
      adjustFrequency: { type: String, default: 'daily' }, // daily/weekly
    },
    
    // 出价调整规则
    bidAdjust: {
      enabled: { type: Boolean, default: false },
      strategy: { type: String, default: 'target_roas' },
      adjustRange: { type: Number, default: 0.1 },        // 调整幅度 10%
    },
  },
  
  // 告警配置
  alerts: {
    enabled: { type: Boolean, default: true },
    channels: [{
      type: { type: String, enum: ['dingtalk', 'feishu', 'email', 'webhook'] },
      config: mongoose.Schema.Types.Mixed,  // webhook URL, email 等配置
    }],
    thresholds: {
      roasDropPercent: { type: Number, default: 30 },    // ROAS 下降 30%
      spendSpikePercent: { type: Number, default: 50 },  // 消耗暴涨 50%
      cpaIncreasePercent: { type: Number, default: 30 }, // CPA 上升 30%
    },
  },
  
  // 运行时间配置
  schedule: {
    timezone: { type: String, default: 'Asia/Shanghai' },
    activeHours: {
      start: { type: Number, default: 0 },   // 0-23
      end: { type: Number, default: 24 },
    },
    checkInterval: { type: Number, default: 30 }, // 检查间隔（分钟）
  },

  // 运行状态（用于调度器/避免重复执行）
  runtime: {
    lastRunAt: { type: Date },
    lastPlanAt: { type: Date },
  },
  
  // AI 配置
  aiConfig: {
    model: { type: String, default: 'gemini-2.0-flash' },
    useAiDecision: { type: Boolean, default: true },      // 是否使用 AI 决策
    aiDecisionWeight: { type: Number, default: 0.7 },     // AI 决策权重
    requireApproval: { type: Boolean, default: true },    // 是否需要人工审批
    approvalThreshold: { type: Number, default: 100 },    // 金额超过此值需审批
  },

  /**
   * 生命周期评分配置 (Life-Cycle Momentum System)
   * 定义不同消耗阶段的权重矩阵
   */
  scoringConfig: {
    stages: [
      {
        name: { type: String, default: 'Cold Start' },
        minSpend: { type: Number, default: 0 },
        maxSpend: { type: Number, default: 5 },
        weights: {
          cpm: { type: Number, default: 0.4 },
          ctr: { type: Number, default: 0.4 },
          hookRate: { type: Number, default: 0.2 }, // 🆕 冷启动期加入钩子率
          cpc: { type: Number, default: 0 },
          cpa: { type: Number, default: 0 },
          roas: { type: Number, default: 0 },
          atcRate: { type: Number, default: 0 },
        },
      },
      {
        name: { type: String, default: 'Exploration' },
        minSpend: { type: Number, default: 5 },
        maxSpend: { type: Number, default: 30 },
        weights: {
          cpm: { type: Number, default: 0.1 },
          ctr: { type: Number, default: 0.1 },
          cpc: { type: Number, default: 0.1 },
          atcRate: { type: Number, default: 0.3 }, // 🆕 探索期加入加购率
          cpa: { type: Number, default: 0.3 },
          roas: { type: Number, default: 0.1 },
          hookRate: { type: Number, default: 0 },
        },
      },
      {
        name: { type: String, default: 'Scaling' },
        minSpend: { type: Number, default: 30 },
        maxSpend: { type: Number, default: 200 },
        weights: {
          cpm: { type: Number, default: 0 },
          ctr: { type: Number, default: 0.1 },
          cpc: { type: Number, default: 0 },
          atcRate: { type: Number, default: 0.1 },
          cpa: { type: Number, default: 0.1 },
          roas: { type: Number, default: 0.7 },
          hookRate: { type: Number, default: 0 },
        },
      },
      {
        name: { type: String, default: 'Maturity' },
        minSpend: { type: Number, default: 200 },
        maxSpend: { type: Number, default: 999999 },
        weights: {
          cpm: { type: Number, default: 0.1 },
          ctr: { type: Number, default: 0.1 },
          cpc: { type: Number, default: 0 },
          atcRate: { type: Number, default: 0.1 },
          cpa: { type: Number, default: 0.1 },
          roas: { type: Number, default: 0.6 },
          hookRate: { type: Number, default: 0 },
        },
      },
    ],
    // 动能增益敏感度
    momentumSensitivity: { type: Number, default: 0.1 },
    // 归一化基准值 (用于计算 0-100 分)
    baselines: {
      cpm: { type: Number, default: 20 },   // $20 为基准
      ctr: { type: Number, default: 0.01 }, // 1% 为基准
      cpc: { type: Number, default: 1 },    // $1 为基准
      hookRate: { type: Number, default: 0.25 }, // 🆕 25% Hook Rate 为基准
      atcRate: { type: Number, default: 0.05 },  // 🆕 5% ATC Rate 为基准
    },
  },

  /**
   * 评分-操作映射阈值 (Score-to-Action Mappings)
   */
  actionThresholds: {
    aggressiveScale: { 
      minScore: { type: Number, default: 85 },
      changePercent: { type: Number, default: 30 }
    },
    moderateScale: {
      minScore: { type: Number, default: 70 },
      changePercent: { type: Number, default: 15 }
    },
    stopLoss: {
      maxScore: { type: Number, default: 30 },
      changePercent: { type: Number, default: -20 }
    },
    kill: {
      maxScore: { type: Number, default: 15 }
    }
  },
  
  /**
   * 飞书审批配置
   */
  feishuConfig: {
    enabled: { type: Boolean, default: false },
    appId: { type: String },
    appSecret: { type: String },
    receiveId: { type: String }, // 接收消息的群 ID 或用户 ID
    receiveIdType: { type: String, enum: ['open_id', 'chat_id', 'user_id', 'email'], default: 'chat_id' },
  },
  
  createdBy: { type: String },
}, { timestamps: true })

/**
 * Agent 操作日志
 */
const agentOperationSchema = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentConfig', required: true },
  accountId: { type: String, required: true },
  
  // 操作对象
  entityType: { type: String, enum: ['campaign', 'adset', 'ad'], required: true },
  entityId: { type: String, required: true },
  entityName: { type: String },
  
  // 操作类型
  action: {
    type: String,
    enum: ['pause', 'resume', 'budget_increase', 'budget_decrease', 'bid_adjust', 'status_change'],
    required: true,
  },
  
  // 操作详情
  beforeValue: mongoose.Schema.Types.Mixed,
  afterValue: mongoose.Schema.Types.Mixed,
  changePercent: { type: Number },
  
  // 决策依据
  reason: { type: String, required: true },
  aiAnalysis: { type: String },        // AI 分析内容
  dataSnapshot: mongoose.Schema.Types.Mixed,  // 决策时的数据快照
  scoreSnapshot: mongoose.Schema.Types.Mixed, // 详细评分快照 (Life-Cycle Momentum System)
  
  // 执行状态
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'executed', 'failed'],
    default: 'pending',
  },
  executedAt: { type: Date },
  executedBy: { type: String },  // 'system' 或用户 ID
  
  // 执行结果
  result: mongoose.Schema.Types.Mixed,
  error: { type: String },
  
  // 飞书消息 ID (用于更新卡片状态)
  feishuMessageId: { type: String },
  
}, { timestamps: true })

/**
 * 每日报告模型
 */
const dailyReportSchema = new mongoose.Schema({
  date: { type: String, required: true },  // YYYY-MM-DD
  accountId: { type: String },             // 空表示全局报告
  
  // 汇总数据
  summary: {
    totalSpend: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    avgRoas: { type: Number, default: 0 },
    activeCampaigns: { type: Number, default: 0 },
    profitableCampaigns: { type: Number, default: 0 },
    losingCampaigns: { type: Number, default: 0 },
  },
  
  // 变化趋势 (相比前一天/前一周)
  trends: {
    spendChange: { type: Number },        // 消耗变化 %
    roasChange: { type: Number },         // ROAS 变化 %
    revenueChange: { type: Number },      // 收入变化 %
    cpaChange: { type: Number },          // CPA 变化 %
  },
  
  // 异常告警
  alerts: [{
    type: { type: String },   // 'roas_drop', 'spend_spike', 'cpa_increase'
    severity: { type: String, enum: ['info', 'warning', 'critical'] },
    entityType: { type: String },
    entityId: { type: String },
    entityName: { type: String },
    message: { type: String },
    value: { type: Number },
    threshold: { type: Number },
  }],
  
  // Top 表现
  topPerformers: [{
    entityType: { type: String },
    entityId: { type: String },
    entityName: { type: String },
    roas: { type: Number },
    spend: { type: Number },
    revenue: { type: Number },
  }],
  
  // 需要关注
  needsAttention: [{
    entityType: { type: String },
    entityId: { type: String },
    entityName: { type: String },
    issue: { type: String },
    suggestion: { type: String },
  }],
  
  // AI 分析
  aiSummary: { type: String },
  aiRecommendations: [{ type: String }],
  
  // 报告状态
  status: { type: String, enum: ['generating', 'ready', 'sent'], default: 'generating' },
  sentAt: { type: Date },
  sentTo: [{ type: String }],
  
}, { timestamps: true })

dailyReportSchema.index({ date: 1, accountId: 1 }, { unique: true })

/**
 * AI 对话记录
 */
const aiConversationSchema = new mongoose.Schema({
  userId: { type: String },
  
  // 对话上下文
  context: {
    accountId: { type: String },
    entityType: { type: String },
    entityId: { type: String },
  },
  
  // 消息列表
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    
    // AI 消息的元数据
    dataUsed: mongoose.Schema.Types.Mixed,  // 使用了哪些数据
    confidence: { type: Number },           // 置信度
  }],
  
  // 会话状态
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  
}, { timestamps: true })

/**
 * 素材评分模型
 */
const creativeScoreSchema = new mongoose.Schema({
  // 关联
  creativeGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreativeGroup' },
  materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
  
  // 素材信息
  materialUrl: { type: String },
  materialType: { type: String, enum: ['image', 'video'] },
  
  // 表现数据 (聚合多个广告的表现)
  performance: {
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    cpc: { type: Number, default: 0 },
    cpa: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
  },
  
  // AI 评分
  scores: {
    overall: { type: Number, min: 0, max: 100 },       // 综合评分
    engagement: { type: Number, min: 0, max: 100 },    // 互动评分
    conversion: { type: Number, min: 0, max: 100 },    // 转化评分
    efficiency: { type: Number, min: 0, max: 100 },    // 效率评分
  },
  
  // AI 分析
  aiAnalysis: {
    strengths: [{ type: String }],      // 优势
    weaknesses: [{ type: String }],     // 劣势
    recommendations: [{ type: String }], // 建议
  },
  
  // 标签
  tags: [{ type: String }],  // 'top_performer', 'needs_improvement', 'new', 'testing'
  
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true })

creativeScoreSchema.index({ creativeGroupId: 1 })
creativeScoreSchema.index({ 'scores.overall': -1 })

export const AgentConfig = mongoose.model('AgentConfig', agentConfigSchema)
export const AgentOperation = mongoose.model('AgentOperation', agentOperationSchema)
export const DailyReport = mongoose.model('DailyReport', dailyReportSchema)
export const AiConversation = mongoose.model('AiConversation', aiConversationSchema)
export const CreativeScore = mongoose.model('CreativeScore', creativeScoreSchema)

