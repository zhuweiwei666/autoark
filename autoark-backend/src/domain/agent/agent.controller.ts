import { Router, Request, Response } from 'express'
import { agentService } from './agent.service'
import { AgentConfig, AgentOperation, DailyReport, AiConversation } from './agent.model'
import logger from '../../utils/logger'
import { authenticate, authorize } from '../../middlewares/auth'
import { UserRole } from '../../models/User'
import { parseLimitedNumber, pickAllowedString, pickSafeQueryString } from '../../utils/pagination'
import { sanitizeScopedUpdate } from '../../utils/accessControl'

const router = Router()

// 所有 Agent 能力均需要认证（涉及自动调控/审批/对话数据）
router.use(authenticate)
router.use(authorize(UserRole.SUPER_ADMIN))

// ==================== Agent 配置 CRUD ====================

const AGENT_NAME_MAX_LENGTH = 120
const AGENT_DESCRIPTION_MAX_LENGTH = 1000
const AGENT_ID_MAX_LENGTH = 80
const AGENT_ACCOUNT_MAX_COUNT = 500
const AGENT_ASSET_MAX_COUNT = 500
const AGENT_LIST_MAX_LIMIT = 100
const AGENT_REPORT_MAX_LIMIT = 100
const AGENT_CHAT_HISTORY_MAX_LIMIT = 50
const AGENT_MESSAGE_MAX_LENGTH = 4000
const AGENT_REASON_MAX_LENGTH = 1000
const AGENT_CONTEXT_KEY_MAX_LENGTH = 80
const AGENT_CONTEXT_STRING_MAX_LENGTH = 1000
const AGENT_CONTEXT_MAX_KEYS = 50
const AGENT_CONTEXT_MAX_ARRAY_LENGTH = 20
const AGENT_CONTEXT_MAX_DEPTH = 4
const AGENT_BATCH_MATERIAL_MAX_COUNT = 100
const AGENT_STATUS_VALUES = ['active', 'paused', 'disabled'] as const
const AGENT_MODE_VALUES = ['observe', 'suggest', 'auto'] as const
const AGENT_OPERATION_STATUS_VALUES = ['pending', 'approved', 'rejected', 'executed', 'failed'] as const
const AGENT_FEISHU_RECEIVE_ID_TYPES = ['open_id', 'chat_id', 'user_id', 'email'] as const
const AGENT_WEIGHT_KEYS = ['cpm', 'ctr', 'hookRate', 'cpc', 'cpa', 'roas', 'atcRate'] as const

const hasOwn = (input: any, key: string) => Object.prototype.hasOwnProperty.call(input || {}, key)

const pickBoundedNumber = (
  value: any,
  options: { min?: number; max: number; integer?: boolean },
): number | undefined => {
  const next = Number(value)
  const min = options.min ?? 0
  if (!Number.isFinite(next)) return undefined
  const bounded = Math.min(options.max, Math.max(min, next))
  return options.integer ? Math.floor(bounded) : bounded
}

const pickBoolean = (value: any): boolean | undefined => (
  typeof value === 'boolean' ? value : undefined
)

const pickDateOnly = (value: any): string | undefined => {
  const text = pickSafeQueryString(value, 10)
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined
  const parsed = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString().slice(0, 10) === text ? text : undefined
}

const isSafeContextKey = (key: string): boolean => (
  Boolean(key)
  && !key.startsWith('$')
  && !key.includes('.')
  && !['__proto__', 'prototype', 'constructor'].includes(key)
)

const sanitizeAgentRuntimeContextValue = (value: any, depth: number): any => {
  if (typeof value === 'string') return pickSafeQueryString(value, AGENT_CONTEXT_STRING_MAX_LENGTH)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const items = value
      .slice(0, AGENT_CONTEXT_MAX_ARRAY_LENGTH)
      .map((item) => sanitizeAgentRuntimeContextValue(item, depth + 1))
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }
  if (value && typeof value === 'object') {
    return sanitizeAgentRuntimeContext(value, depth + 1)
  }
  return undefined
}

const sanitizeAgentRuntimeContext = (context: any, depth = 0): any | undefined => {
  if (!context || typeof context !== 'object' || Array.isArray(context) || depth > AGENT_CONTEXT_MAX_DEPTH) {
    return undefined
  }

  const data: any = {}
  for (const [rawKey, rawValue] of Object.entries(context).slice(0, AGENT_CONTEXT_MAX_KEYS)) {
    const key = pickSafeQueryString(rawKey, AGENT_CONTEXT_KEY_MAX_LENGTH)
    if (!key || !isSafeContextKey(key)) continue
    const value = sanitizeAgentRuntimeContextValue(rawValue, depth)
    if (value !== undefined) data[key] = value
  }

  return Object.keys(data).length > 0 ? data : undefined
}

const pickStringList = (value: any, maxCount: number, maxLength = AGENT_ID_MAX_LENGTH): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  return Array.from(new Set(value
    .map((item: any) => pickSafeQueryString(item, maxLength))
    .filter(Boolean) as string[]))
    .slice(0, maxCount)
}

const setNumber = (
  target: any,
  source: any,
  key: string,
  options: { min?: number; max: number; integer?: boolean },
) => {
  if (!hasOwn(source, key)) return
  const value = pickBoundedNumber(source[key], options)
  if (value !== undefined) target[key] = value
}

const setBoolean = (target: any, source: any, key: string) => {
  if (!hasOwn(source, key)) return
  const value = pickBoolean(source[key])
  if (value !== undefined) target[key] = value
}

const sanitizeAgentScope = (scope: any) => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return undefined
  const data: any = {}

  const adAccountIds = pickStringList(scope.adAccountIds, AGENT_ACCOUNT_MAX_COUNT, 64)
  if (adAccountIds) data.adAccountIds = adAccountIds
  const fbTokenIds = pickStringList(scope.fbTokenIds, AGENT_ASSET_MAX_COUNT)
  if (fbTokenIds) data.fbTokenIds = fbTokenIds
  const tiktokTokenIds = pickStringList(scope.tiktokTokenIds, AGENT_ASSET_MAX_COUNT)
  if (tiktokTokenIds) data.tiktokTokenIds = tiktokTokenIds
  const facebookAppIds = pickStringList(scope.facebookAppIds, AGENT_ASSET_MAX_COUNT)
  if (facebookAppIds) data.facebookAppIds = facebookAppIds

  ;['materials', 'targetingPackages', 'copywritingPackages'].forEach((key) => {
    const input = scope[key]
    if (!input || typeof input !== 'object' || Array.isArray(input)) return
    const next: any = {}
    setBoolean(next, input, 'allowAll')
    setBoolean(next, input, 'allowCreate')
    ;['folderIds', 'materialIds', 'packageIds'].forEach((listKey) => {
      const values = pickStringList(input[listKey], AGENT_ASSET_MAX_COUNT)
      if (values) next[listKey] = values
    })
    if (Object.keys(next).length > 0) data[key] = next
  })

  return Object.keys(data).length > 0 ? data : undefined
}

const sanitizeAgentPermissions = (permissions: any) => {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return undefined
  const data: any = {}
  ;[
    'canPublishAds',
    'canToggleStatus',
    'canAdjustBudget',
    'canAdjustBid',
    'canPause',
    'canResume',
  ].forEach((key) => setBoolean(data, permissions, key))
  return Object.keys(data).length > 0 ? data : undefined
}

const sanitizeAgentObjectives = (objectives: any) => {
  if (!objectives || typeof objectives !== 'object' || Array.isArray(objectives)) return undefined
  const data: any = {}
  setNumber(data, objectives, 'targetRoas', { max: 100 })
  setNumber(data, objectives, 'maxCpa', { max: 1_000_000 })
  setNumber(data, objectives, 'dailyBudgetLimit', { max: 10_000_000 })
  setNumber(data, objectives, 'monthlyBudgetLimit', { max: 300_000_000 })
  return Object.keys(data).length > 0 ? data : undefined
}

const sanitizeAgentRules = (rules: any) => {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return undefined
  const data: any = {}

  if (rules.autoStop && typeof rules.autoStop === 'object' && !Array.isArray(rules.autoStop)) {
    const autoStop: any = {}
    setBoolean(autoStop, rules.autoStop, 'enabled')
    setNumber(autoStop, rules.autoStop, 'roasThreshold', { max: 100 })
    setNumber(autoStop, rules.autoStop, 'minDays', { min: 1, max: 365, integer: true })
    setNumber(autoStop, rules.autoStop, 'minSpend', { max: 1_000_000 })
    if (Object.keys(autoStop).length > 0) data.autoStop = autoStop
  }

  if (rules.autoScale && typeof rules.autoScale === 'object' && !Array.isArray(rules.autoScale)) {
    const autoScale: any = {}
    setBoolean(autoScale, rules.autoScale, 'enabled')
    setNumber(autoScale, rules.autoScale, 'roasThreshold', { max: 100 })
    setNumber(autoScale, rules.autoScale, 'minDays', { min: 1, max: 365, integer: true })
    setNumber(autoScale, rules.autoScale, 'budgetIncrease', { max: 10 })
    setNumber(autoScale, rules.autoScale, 'maxBudget', { max: 10_000_000 })
    if (Object.keys(autoScale).length > 0) data.autoScale = autoScale
  }

  if (rules.budgetAdjust && typeof rules.budgetAdjust === 'object' && !Array.isArray(rules.budgetAdjust)) {
    const budgetAdjust: any = {}
    setBoolean(budgetAdjust, rules.budgetAdjust, 'enabled')
    setNumber(budgetAdjust, rules.budgetAdjust, 'minAdjustPercent', { max: 10 })
    setNumber(budgetAdjust, rules.budgetAdjust, 'maxAdjustPercent', { max: 10 })
    const adjustFrequency = pickAllowedString(rules.budgetAdjust.adjustFrequency, ['daily', 'weekly'], '')
    if (adjustFrequency) budgetAdjust.adjustFrequency = adjustFrequency
    if (Object.keys(budgetAdjust).length > 0) data.budgetAdjust = budgetAdjust
  }

  if (rules.bidAdjust && typeof rules.bidAdjust === 'object' && !Array.isArray(rules.bidAdjust)) {
    const bidAdjust: any = {}
    setBoolean(bidAdjust, rules.bidAdjust, 'enabled')
    const strategy = pickSafeQueryString(rules.bidAdjust.strategy, 60)
    if (strategy) bidAdjust.strategy = strategy
    setNumber(bidAdjust, rules.bidAdjust, 'adjustRange', { max: 10 })
    if (Object.keys(bidAdjust).length > 0) data.bidAdjust = bidAdjust
  }

  return Object.keys(data).length > 0 ? data : undefined
}

const sanitizeAgentAiConfig = (aiConfig: any) => {
  if (!aiConfig || typeof aiConfig !== 'object' || Array.isArray(aiConfig)) return undefined
  const data: any = {}
  const model = pickSafeQueryString(aiConfig.model, 80)
  if (model) data.model = model
  setBoolean(data, aiConfig, 'useAiDecision')
  setNumber(data, aiConfig, 'aiDecisionWeight', { max: 1 })
  setBoolean(data, aiConfig, 'requireApproval')
  setNumber(data, aiConfig, 'approvalThreshold', { max: 10_000_000 })
  return Object.keys(data).length > 0 ? data : undefined
}

const sanitizeAgentScoringConfig = (scoringConfig: any) => {
  if (!scoringConfig || typeof scoringConfig !== 'object' || Array.isArray(scoringConfig)) return undefined
  const data: any = {}

  if (Array.isArray(scoringConfig.stages)) {
    data.stages = scoringConfig.stages.slice(0, 8)
      .filter((stage: any) => stage && typeof stage === 'object' && !Array.isArray(stage))
      .map((stage: any) => {
        const next: any = {}
        const name = pickSafeQueryString(stage.name, 80)
        if (name) next.name = name
        setNumber(next, stage, 'minSpend', { max: 10_000_000 })
        setNumber(next, stage, 'maxSpend', { max: 10_000_000 })
        if (stage.weights && typeof stage.weights === 'object' && !Array.isArray(stage.weights)) {
          const weights: any = {}
          AGENT_WEIGHT_KEYS.forEach((key) => setNumber(weights, stage.weights, key, { max: 1 }))
          if (Object.keys(weights).length > 0) next.weights = weights
        }
        return next
      })
      .filter((stage: any) => Object.keys(stage).length > 0)
  }

  setNumber(data, scoringConfig, 'momentumSensitivity', { max: 1 })
  if (scoringConfig.baselines && typeof scoringConfig.baselines === 'object' && !Array.isArray(scoringConfig.baselines)) {
    const baselines: any = {}
    setNumber(baselines, scoringConfig.baselines, 'cpm', { max: 10_000 })
    setNumber(baselines, scoringConfig.baselines, 'ctr', { max: 1 })
    setNumber(baselines, scoringConfig.baselines, 'cpc', { max: 10_000 })
    setNumber(baselines, scoringConfig.baselines, 'hookRate', { max: 1 })
    setNumber(baselines, scoringConfig.baselines, 'atcRate', { max: 1 })
    if (Object.keys(baselines).length > 0) data.baselines = baselines
  }

  return Object.keys(data).length > 0 ? data : undefined
}

const sanitizeAgentActionThresholds = (thresholds: any) => {
  if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) return undefined
  const data: any = {}
  ;['aggressiveScale', 'moderateScale'].forEach((key) => {
    const input = thresholds[key]
    if (!input || typeof input !== 'object' || Array.isArray(input)) return
    const next: any = {}
    setNumber(next, input, 'minScore', { max: 100, integer: true })
    setNumber(next, input, 'changePercent', { max: 100, integer: true })
    if (Object.keys(next).length > 0) data[key] = next
  })
  ;['stopLoss', 'kill'].forEach((key) => {
    const input = thresholds[key]
    if (!input || typeof input !== 'object' || Array.isArray(input)) return
    const next: any = {}
    setNumber(next, input, 'maxScore', { max: 100, integer: true })
    setNumber(next, input, 'changePercent', { min: -100, max: 100, integer: true })
    if (Object.keys(next).length > 0) data[key] = next
  })
  return Object.keys(data).length > 0 ? data : undefined
}

const sanitizeAgentFeishuConfig = (feishuConfig: any) => {
  if (!feishuConfig || typeof feishuConfig !== 'object' || Array.isArray(feishuConfig)) return undefined
  const data: any = {}
  setBoolean(data, feishuConfig, 'enabled')
  ;[
    ['appId', 120],
    ['appSecret', 240],
    ['receiveId', 240],
  ].forEach(([key, maxLength]) => {
    const value = pickSafeQueryString(feishuConfig[key as string], maxLength as number)
    if (value) data[key as string] = value
  })
  const receiveIdType = pickAllowedString(feishuConfig.receiveIdType, AGENT_FEISHU_RECEIVE_ID_TYPES, '')
  if (receiveIdType) data.receiveIdType = receiveIdType
  return Object.keys(data).length > 0 ? data : undefined
}

const sanitizeAgentConfigInput = (input: any, options: { allowOrganizationId?: boolean } = {}) => {
  const raw = input || {}
  const scoped = sanitizeScopedUpdate(raw)
  delete scoped.runtime

  const data: any = {}
  const name = pickSafeQueryString(scoped.name, AGENT_NAME_MAX_LENGTH)
  if (name) data.name = name
  if (hasOwn(scoped, 'description')) data.description = pickSafeQueryString(scoped.description, AGENT_DESCRIPTION_MAX_LENGTH) || ''
  if (options.allowOrganizationId && hasOwn(raw, 'organizationId')) {
    const organizationId = pickSafeQueryString(raw.organizationId, AGENT_ID_MAX_LENGTH)
    if (organizationId) data.organizationId = organizationId
  }

  const accountIds = pickStringList(scoped.accountIds, AGENT_ACCOUNT_MAX_COUNT, 64)
  if (accountIds) data.accountIds = accountIds
  const status = pickAllowedString(scoped.status, AGENT_STATUS_VALUES, '')
  if (status) data.status = status
  const mode = pickAllowedString(scoped.mode, AGENT_MODE_VALUES, '')
  if (mode) data.mode = mode

  const scope = sanitizeAgentScope(scoped.scope)
  if (scope) data.scope = scope
  const permissions = sanitizeAgentPermissions(scoped.permissions)
  if (permissions) data.permissions = permissions
  const objectives = sanitizeAgentObjectives(scoped.objectives)
  if (objectives) data.objectives = objectives
  const rules = sanitizeAgentRules(scoped.rules)
  if (rules) data.rules = rules
  const aiConfig = sanitizeAgentAiConfig(scoped.aiConfig)
  if (aiConfig) data.aiConfig = aiConfig
  const scoringConfig = sanitizeAgentScoringConfig(scoped.scoringConfig)
  if (scoringConfig) data.scoringConfig = scoringConfig
  const actionThresholds = sanitizeAgentActionThresholds(scoped.actionThresholds)
  if (actionThresholds) data.actionThresholds = actionThresholds
  const feishuConfig = sanitizeAgentFeishuConfig(scoped.feishuConfig)
  if (feishuConfig) data.feishuConfig = feishuConfig

  return data
}

// 获取所有 Agent
router.get('/agents', async (req: Request, res: Response) => {
  try {
    const filter: any = {}
    // 超级管理员可看全部；组织内用户默认看本组织
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      if (req.user?.organizationId) filter.organizationId = req.user.organizationId
      // 如果没有组织，则仅看自己创建的
      else if (req.user?.userId) filter.createdBy = req.user.userId
    }

    const agents = await agentService.getAgents(filter)
    res.json({ success: true, data: agents })
  } catch (error: any) {
    logger.error('[AgentController] Get agents failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取单个 Agent
router.get('/agents/:id', async (req: Request, res: Response) => {
  try {
    const agent = await agentService.getAgentById(req.params.id)
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' })
    }
    res.json({ success: true, data: agent })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 创建 Agent
router.post('/agents', async (req: Request, res: Response) => {
  try {
    const sanitized = sanitizeAgentConfigInput(req.body, { allowOrganizationId: true })
    if (!sanitized.name) {
      return res.status(400).json({ success: false, error: '请输入 Agent 名称' })
    }
    const payload = {
      ...sanitized,
      createdBy: req.user?.userId,
      // 默认继承组织隔离
      organizationId: sanitized.organizationId || req.user?.organizationId,
    }
    const agent = await agentService.createAgent(payload)
    res.status(201).json({ success: true, data: agent })
  } catch (error: any) {
    logger.error('[AgentController] Create agent failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 更新 Agent
router.put('/agents/:id', async (req: Request, res: Response) => {
  try {
    const agent = await agentService.updateAgent(req.params.id, sanitizeAgentConfigInput(req.body))
    res.json({ success: true, data: agent })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 删除 Agent
router.delete('/agents/:id', async (req: Request, res: Response) => {
  try {
    await agentService.deleteAgent(req.params.id)
    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 运行 Agent
router.post('/agents/:id/run', async (req: Request, res: Response) => {
  try {
    const result = await agentService.runAgent(req.params.id)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[AgentController] Run agent failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 运行 Agent（Planner/Executor）：生成 operations 并创建 AutomationJobs 执行
router.post('/agents/:id/run-jobs', async (req: Request, res: Response) => {
  try {
    const { createAutomationJob } = await import('../../services/automationJob.service')
    const agentId = req.params.id
    
    // 创建一个即时运行的 Job (手动触发增加时间戳，确保不被幂等拦截)
    const job = await createAutomationJob({
      type: 'RUN_AGENT_AS_JOBS',
      payload: { agentId, manual: true, triggeredAt: new Date().toISOString() },
      agentId,
      organizationId: req.user?.organizationId,
      createdBy: req.user?.userId,
      priority: 10, // 高优先级
      idempotencyKey: `manual:agent:${agentId}:${Date.now()}`,
    })

    res.json({ 
      success: true, 
      data: { 
        jobId: job._id,
        status: job.status,
        message: 'Agent 运行任务已入队，请在“自动化任务”页面查看进度'
      } 
    })
  } catch (error: any) {
    logger.error('[AgentController] Run agent as jobs failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Agent 操作日志 ====================

// 获取待审批操作
router.get('/operations/pending', async (req: Request, res: Response) => {
  try {
    const operations = await agentService.getPendingOperations()
    res.json({ success: true, data: operations })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取操作历史
router.get('/operations', async (req: Request, res: Response) => {
  try {
    const query: any = {}
    const status = pickAllowedString(req.query.status, AGENT_OPERATION_STATUS_VALUES, '')
    const agentId = pickSafeQueryString(req.query.agentId, AGENT_ID_MAX_LENGTH)
    const accountId = pickSafeQueryString(req.query.accountId, 64)
    if (status) query.status = status
    if (agentId) query.agentId = agentId
    if (accountId) query.accountId = accountId
    const limit = parseLimitedNumber(req.query.limit, 50, AGENT_LIST_MAX_LIMIT)
    
    const operations = await AgentOperation.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
    res.json({ success: true, data: operations })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 审批操作
router.post('/operations/:id/approve', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId || 'unknown'
    const result = await agentService.approveOperation(req.params.id, userId)
    res.json({ success: true, data: result })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 拒绝操作
router.post('/operations/:id/reject', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId || 'unknown'
    const reason = pickSafeQueryString(req.body?.reason, AGENT_REASON_MAX_LENGTH)
    const result = await agentService.rejectOperation(req.params.id, userId, reason)
    res.json({ success: true, data: result })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 每日报告 ====================

// 生成报告
router.post('/reports/generate', async (req: Request, res: Response) => {
  try {
    const reportDate = pickDateOnly(req.body?.date) || new Date().toISOString().split('T')[0]
    const accountId = pickSafeQueryString(req.body?.accountId, 64)
    const report = await agentService.generateDailyReport(reportDate, accountId)
    res.json({ success: true, data: report })
  } catch (error: any) {
    logger.error('[AgentController] Generate report failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取报告列表
router.get('/reports', async (req: Request, res: Response) => {
  try {
    const query: any = {}
    const startDate = pickDateOnly(req.query.startDate)
    const endDate = pickDateOnly(req.query.endDate)
    const accountId = pickSafeQueryString(req.query.accountId, 64)
    const limit = parseLimitedNumber(req.query.limit, 30, AGENT_REPORT_MAX_LIMIT)
    
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate }
    } else if (startDate) {
      query.date = { $gte: startDate }
    } else if (endDate) {
      query.date = { $lte: endDate }
    }
    
    if (accountId) query.accountId = accountId
    
    const reports = await DailyReport.find(query)
      .sort({ date: -1 })
      .limit(limit)
    res.json({ success: true, data: reports })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取最新报告
router.get('/reports/latest', async (req: Request, res: Response) => {
  try {
    const accountId = pickSafeQueryString(req.query.accountId, 64)
    const query: any = { status: 'ready' }
    if (accountId) query.accountId = accountId

    const report = await DailyReport.findOne(query).sort({ date: -1 })
    res.json({ success: true, data: report })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取单个报告
router.get('/reports/:id', async (req: Request, res: Response) => {
  try {
    const report = await DailyReport.findById(req.params.id)
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' })
    }
    res.json({ success: true, data: report })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== AI 对话 ====================

// 发送消息（需要认证，每个用户独立对话历史）
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const message = pickSafeQueryString(req.body?.message, AGENT_MESSAGE_MAX_LENGTH)
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' })
    }
    const context = sanitizeAgentRuntimeContext(req.body?.context)
    
    // 使用当前登录用户的 ID
    const userId = req.user?.userId || 'default-user'
    const response = await agentService.chat(userId, message, context)
    res.json({ success: true, data: { response } })
  } catch (error: any) {
    logger.error('[AgentController] Chat failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取对话历史（需要认证，只返回当前用户的对话）
router.get('/chat/history', async (req: Request, res: Response) => {
  try {
    const limit = parseLimitedNumber(req.query.limit, 10, AGENT_CHAT_HISTORY_MAX_LIMIT)
    const userId = req.user?.userId || 'default-user'
    
    const conversations = await AiConversation.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
    res.json({ success: true, data: conversations })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 清除对话（需要认证，只清除当前用户的对话）
router.delete('/chat/clear', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId || 'default-user'
    
    await AiConversation.updateMany(
      { userId, status: 'active' },
      { status: 'closed' }
    )
    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 数据分析 ====================

// 获取账户健康度分析
router.get('/analysis/health', async (req: Request, res: Response) => {
  try {
    const accountId = pickSafeQueryString(req.query.accountId, 64)
    
    // 获取最近 7 天数据
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 7)
    
    const query: any = {
      date: { $gte: startDate.toISOString().split('T')[0] },
      campaignId: { $exists: true, $ne: null },
    }
    if (accountId) query.accountId = accountId
    
    const data = await require('../../models/MetricsDaily').default.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$date',
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          conversions: { $sum: { $ifNull: ['$conversions', 0] } },
        }
      },
      { $sort: { _id: 1 } },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $divide: ['$clicks', '$impressions'] }, 0] },
        }
      }
    ])
    
    // 计算健康度评分
    const totalSpend = data.reduce((sum: number, d: any) => sum + d.spend, 0)
    const totalRevenue = data.reduce((sum: number, d: any) => sum + d.revenue, 0)
    const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0
    
    let healthScore = 50 // 基础分
    if (avgRoas > 2) healthScore += 30
    else if (avgRoas > 1.5) healthScore += 20
    else if (avgRoas > 1) healthScore += 10
    else if (avgRoas < 0.5) healthScore -= 20
    
    // 趋势加分
    if (data.length >= 3) {
      const recent = data.slice(-3)
      const older = data.slice(0, -3)
      const recentRoas = recent.reduce((s: number, d: any) => s + d.roas, 0) / recent.length
      const olderRoas = older.length > 0 ? older.reduce((s: number, d: any) => s + d.roas, 0) / older.length : recentRoas
      if (recentRoas > olderRoas) healthScore += 10
      else if (recentRoas < olderRoas * 0.8) healthScore -= 10
    }
    
    healthScore = Math.max(0, Math.min(100, healthScore))
    
    res.json({
      success: true,
      data: {
        healthScore,
        trend: data,
        summary: {
          totalSpend,
          totalRevenue,
          avgRoas,
          days: data.length,
        },
        status: healthScore >= 70 ? 'healthy' : healthScore >= 40 ? 'attention' : 'critical',
      }
    })
  } catch (error: any) {
    logger.error('[AgentController] Health analysis failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 获取 AI 分析建议
router.post('/analysis/suggest', async (req: Request, res: Response) => {
  try {
    const accountId = pickSafeQueryString(req.body?.accountId, 64)
    const campaignId = pickSafeQueryString(req.body?.campaignId, 80)
    
    const context: any = {}
    if (accountId) context.accountId = accountId
    if (campaignId) context.campaignId = campaignId
    
    const prompt = pickSafeQueryString(req.body?.question, AGENT_MESSAGE_MAX_LENGTH) || '请分析当前投放情况并给出优化建议'
    const userId = req.user?.userId || 'default-user'
    const response = await agentService.chat(userId, prompt, Object.keys(context).length > 0 ? context : undefined)
    
    res.json({ success: true, data: { response } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== 素材 AI 分析 ====================

// 🤖 AI 分析单个素材
router.get('/materials/:id/analyze', async (req: Request, res: Response) => {
  try {
    const result = await agentService.analyzeMaterialWithAI(req.params.id)
    res.json(result)
  } catch (error: any) {
    logger.error('[AgentController] Material AI analysis failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 🤖 批量 AI 分析素材
router.post('/materials/analyze-batch', async (req: Request, res: Response) => {
  try {
    const materialIds = pickStringList(req.body?.materialIds, AGENT_BATCH_MATERIAL_MAX_COUNT, AGENT_ID_MAX_LENGTH)
    if (!materialIds || materialIds.length === 0) {
      return res.status(400).json({ success: false, error: 'materialIds array is required' })
    }
    const results = await agentService.batchAnalyzeMaterials(materialIds)
    res.json({ success: true, data: results })
  } catch (error: any) {
    logger.error('[AgentController] Batch material analysis failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 🤖 获取 AI 推荐的素材操作
router.get('/materials/recommendations', async (req: Request, res: Response) => {
  try {
    const result = await agentService.getAIRecommendedActions()
    res.json(result)
  } catch (error: any) {
    logger.error('[AgentController] Get AI recommendations failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
