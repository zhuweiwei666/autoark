import logger from '../utils/logger'
import { AutoRule, IAutoRule, ICondition, MetricType, TimeRange, IRuleExecution } from '../models/AutoRule'
import Campaign from '../models/Campaign'
import AdSet from '../models/AdSet'
import Ad from '../models/Ad'
import MetricsDaily from '../models/MetricsDaily'
import { updateCampaign, updateAdSet, updateAd } from '../integration/facebook/bulkCreate.api'
import FbToken from '../models/FbToken'
import dayjs from 'dayjs'

/**
 * 🤖 规则引擎服务
 * 
 * 核心功能：
 * 1. 规则评估 - 检查实体是否满足规则条件
 * 2. 规则执行 - 对满足条件的实体执行动作
 * 3. 执行记录 - 记录每次执行的结果
 */

// ==================== 辅助函数 ====================

/**
 * 获取时间范围
 */
function getDateRange(timeRange: TimeRange): { start: string; end: string } {
  const today = dayjs().format('YYYY-MM-DD')
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
  
  switch (timeRange) {
    case 'today':
      return { start: today, end: today }
    case 'yesterday':
      return { start: yesterday, end: yesterday }
    case 'last_3_days':
      return { start: dayjs().subtract(3, 'day').format('YYYY-MM-DD'), end: today }
    case 'last_7_days':
      return { start: dayjs().subtract(7, 'day').format('YYYY-MM-DD'), end: today }
    case 'lifetime':
      return { start: '2020-01-01', end: today }
    default:
      return { start: yesterday, end: today }
  }
}

/**
 * 获取实体的指标数据
 */
async function getEntityMetrics(
  entityLevel: string,
  entityId: string,
  timeRange: TimeRange
): Promise<Record<MetricType, number>> {
  const { start, end } = getDateRange(timeRange)
  
  // 根据实体级别确定查询字段
  const matchField = entityLevel === 'campaign' ? 'campaignId' 
    : entityLevel === 'adset' ? 'adsetId' 
    : 'adId'
  
  const result = await MetricsDaily.aggregate([
    {
      $match: {
        [matchField]: entityId,
        date: { $gte: start, $lte: end },
      }
    },
    {
      $group: {
        _id: null,
        spend: { $sum: '$spendUsd' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        installs: { $sum: '$installs' },
        purchases: { $sum: '$purchases' },
        purchaseValue: { $sum: '$purchaseValueUsd' },
      }
    }
  ])
  
  if (!result.length) {
    return {
      roas: 0, spend: 0, ctr: 0, cpm: 0, cpc: 0,
      impressions: 0, clicks: 0, installs: 0, purchases: 0
    }
  }
  
  const data = result[0]
  const spend = data.spend || 0
  const impressions = data.impressions || 0
  const clicks = data.clicks || 0
  const purchaseValue = data.purchaseValue || 0
  
  return {
    roas: spend > 0 ? purchaseValue / spend : 0,
    spend,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    impressions,
    clicks,
    installs: data.installs || 0,
    purchases: data.purchases || 0,
  }
}

/**
 * 检查条件是否满足
 */
function checkCondition(condition: ICondition, metrics: Record<MetricType, number>): boolean {
  const actualValue = metrics[condition.metric]
  
  switch (condition.operator) {
    case 'gt':
      return actualValue > condition.value
    case 'gte':
      return actualValue >= condition.value
    case 'lt':
      return actualValue < condition.value
    case 'lte':
      return actualValue <= condition.value
    case 'eq':
      return actualValue === condition.value
    case 'between':
      return actualValue >= condition.value && actualValue <= (condition.value2 || condition.value)
    default:
      return false
  }
}

/**
 * 获取可用的 Facebook Token
 */
async function getAvailableToken(accountId: string): Promise<string | null> {
  const token = await FbToken.findOne({
    accounts: { $elemMatch: { accountId } },
    isValid: true,
  })
  return token?.token || null
}

// ==================== 规则服务 ====================

class RuleService {
  
  /**
   * 获取所有规则
   */
  async getRules(filters?: { status?: string; createdBy?: string }): Promise<IAutoRule[]> {
    const query: any = {}
    if (filters?.status) query.status = filters.status
    if (filters?.createdBy) query.createdBy = filters.createdBy
    
    return AutoRule.find(query).sort({ createdAt: -1 })
  }
  
  /**
   * 获取单个规则
   */
  async getRuleById(id: string): Promise<IAutoRule | null> {
    return AutoRule.findById(id)
  }
  
  /**
   * 创建规则
   */
  async createRule(data: Partial<IAutoRule>): Promise<IAutoRule> {
    const rule = new AutoRule(data)
    await rule.save()
    logger.info(`[RuleService] Created rule: ${rule.name} (${rule._id})`)
    return rule
  }
  
  /**
   * 更新规则
   */
  async updateRule(id: string, data: Partial<IAutoRule>): Promise<IAutoRule | null> {
    const rule = await AutoRule.findByIdAndUpdate(id, data, { new: true })
    if (rule) {
      logger.info(`[RuleService] Updated rule: ${rule.name}`)
    }
    return rule
  }
  
  /**
   * 删除规则
   */
  async deleteRule(id: string): Promise<boolean> {
    const result = await AutoRule.findByIdAndDelete(id)
    return !!result
  }
  
  /**
   * 执行单个规则
   */
  async executeRule(ruleId: string): Promise<IRuleExecution> {
    const rule = await AutoRule.findById(ruleId)
    if (!rule) {
      throw new Error('Rule not found')
    }
    
    if (rule.status !== 'active') {
      throw new Error('Rule is not active')
    }
    
    logger.info(`[RuleService] Executing rule: ${rule.name}`)
    
    const execution: IRuleExecution = {
      executedAt: new Date(),
      entitiesChecked: 0,
      entitiesAffected: 0,
      details: [],
    }
    
    try {
      // 获取需要检查的实体
      const entities = await this.getEntitiesToCheck(rule)
      execution.entitiesChecked = entities.length
      
      logger.info(`[RuleService] Checking ${entities.length} entities for rule: ${rule.name}`)
      
      // 逐个检查和执行
      for (const entity of entities) {
        // 检查执行限制
        if (rule.limits.maxEntitiesPerExecution && 
            execution.entitiesAffected >= rule.limits.maxEntitiesPerExecution) {
          logger.info(`[RuleService] Max entities limit reached: ${rule.limits.maxEntitiesPerExecution}`)
          break
        }
        
        // 获取指标并检查条件
        const metrics = await getEntityMetrics(
          rule.entityLevel,
          entity.id,
          rule.conditions[0]?.timeRange || 'last_3_days'
        )
        
        // 检查所有条件（AND 逻辑）
        const allConditionsMet = rule.conditions.every(cond => checkCondition(cond, metrics))
        
        if (allConditionsMet) {
          // 执行动作
          const result = await this.executeAction(rule, entity, metrics)
          execution.details.push(result)
          if (result.success) {
            execution.entitiesAffected++
          }
        }
      }
      
      // 更新规则统计
      rule.stats.totalExecutions++
      rule.stats.lastExecutedAt = new Date()
      rule.stats.totalEntitiesAffected += execution.entitiesAffected
      
      // 保存执行记录（最多 100 条）
      rule.executions.unshift(execution)
      if (rule.executions.length > 100) {
        rule.executions = rule.executions.slice(0, 100)
      }
      
      await rule.save()
      
      logger.info(`[RuleService] Rule ${rule.name} executed: ${execution.entitiesAffected}/${execution.entitiesChecked} affected`)
      
    } catch (error: any) {
      logger.error(`[RuleService] Rule execution failed: ${error.message}`)
      execution.details.push({
        entityId: 'system',
        entityName: 'System Error',
        action: 'error',
        success: false,
        error: error.message,
      })
    }
    
    return execution
  }
  
  /**
   * 获取需要检查的实体列表
   */
  private async getEntitiesToCheck(rule: IAutoRule): Promise<Array<{ id: string; name: string; accountId: string }>> {
    const query: any = { status: 'ACTIVE' }
    
    // 账户过滤
    if (rule.accountIds && rule.accountIds.length > 0) {
      query.accountId = { $in: rule.accountIds }
    }
    
    // 广告系列过滤
    if (rule.campaignIds && rule.campaignIds.length > 0) {
      query.campaignId = { $in: rule.campaignIds }
    }
    
    let entities: Array<{ id: string; name: string; accountId: string }> = []
    
    switch (rule.entityLevel) {
      case 'campaign':
        const campaigns = await Campaign.find(query).select('campaignId name accountId').lean()
        entities = campaigns.map(c => ({ 
          id: c.campaignId, 
          name: c.name, 
          accountId: c.accountId 
        }))
        break
        
      case 'adset':
        const adsets = await AdSet.find(query).select('adsetId name accountId').lean()
        entities = adsets.map(a => ({ 
          id: a.adsetId, 
          name: a.name, 
          accountId: a.accountId 
        }))
        break
        
      case 'ad':
        const ads = await Ad.find(query).select('adId name accountId').lean()
        entities = ads.map(a => ({ 
          id: a.adId, 
          name: a.name, 
          accountId: a.accountId 
        }))
        break
    }
    
    return entities
  }
  
  /**
   * 执行具体动作
   */
  private async executeAction(
    rule: IAutoRule,
    entity: { id: string; name: string; accountId: string },
    metrics: Record<MetricType, number>
  ): Promise<IRuleExecution['details'][0]> {
    
    const result: IRuleExecution['details'][0] = {
      entityId: entity.id,
      entityName: entity.name,
      action: rule.action.type,
      success: false,
    }
    
    try {
      const token = await getAvailableToken(entity.accountId)
      if (!token) {
        result.error = 'No valid token found'
        return result
      }
      
      switch (rule.action.type) {
        case 'auto_pause':
          await this.pauseEntity(rule.entityLevel, entity.id, token)
          result.oldValue = 'ACTIVE'
          result.newValue = 'PAUSED'
          result.success = true
          logger.info(`[RuleService] Paused ${rule.entityLevel} ${entity.name} (ROAS: ${metrics.roas.toFixed(2)}, Spend: $${metrics.spend.toFixed(2)})`)
          break
          
        case 'auto_enable':
          await this.enableEntity(rule.entityLevel, entity.id, token)
          result.oldValue = 'PAUSED'
          result.newValue = 'ACTIVE'
          result.success = true
          break
          
        case 'budget_up':
        case 'budget_down':
          const budgetResult = await this.adjustBudget(
            rule.entityLevel,
            entity.id,
            token,
            rule.action,
            metrics
          )
          result.oldValue = budgetResult.oldBudget
          result.newValue = budgetResult.newBudget
          result.success = budgetResult.success
          result.error = budgetResult.error
          if (result.success) {
            logger.info(`[RuleService] Budget ${rule.action.type === 'budget_up' ? 'increased' : 'decreased'} for ${entity.name}: $${budgetResult.oldBudget} -> $${budgetResult.newBudget} (ROAS: ${metrics.roas.toFixed(2)})`)
          }
          break
          
        case 'alert':
          // 发送 Webhook 通知
          await this.sendAlert(rule, entity, metrics)
          result.success = true
          logger.info(`[RuleService] Alert sent for ${entity.name} - ROAS: ${metrics.roas.toFixed(2)}, Spend: $${metrics.spend.toFixed(2)}`)
          break
          
        default:
          result.error = `Unknown action type: ${rule.action.type}`
      }
      
    } catch (error: any) {
      result.error = error.message
      logger.error(`[RuleService] Action failed for ${entity.name}: ${error.message}`)
    }
    
    return result
  }
  
  /**
   * 暂停实体
   */
  private async pauseEntity(level: string, entityId: string, token: string): Promise<void> {
    switch (level) {
      case 'campaign':
        await updateCampaign({ token, campaignId: entityId, status: 'PAUSED' })
        await Campaign.updateOne({ campaignId: entityId }, { status: 'PAUSED' })
        break
      case 'adset':
        await updateAdSet({ token, adsetId: entityId, status: 'PAUSED' })
        await AdSet.updateOne({ adsetId: entityId }, { status: 'PAUSED' })
        break
      case 'ad':
        await updateAd({ token, adId: entityId, status: 'PAUSED' })
        await Ad.updateOne({ adId: entityId }, { status: 'PAUSED' })
        break
    }
  }
  
  /**
   * 启用实体
   */
  private async enableEntity(level: string, entityId: string, token: string): Promise<void> {
    switch (level) {
      case 'campaign':
        await updateCampaign({ token, campaignId: entityId, status: 'ACTIVE' })
        await Campaign.updateOne({ campaignId: entityId }, { status: 'ACTIVE' })
        break
      case 'adset':
        await updateAdSet({ token, adsetId: entityId, status: 'ACTIVE' })
        await AdSet.updateOne({ adsetId: entityId }, { status: 'ACTIVE' })
        break
      case 'ad':
        await updateAd({ token, adId: entityId, status: 'ACTIVE' })
        await Ad.updateOne({ adId: entityId }, { status: 'ACTIVE' })
        break
    }
  }
  
  /**
   * 调整预算
   */
  private async adjustBudget(
    level: string,
    entityId: string,
    token: string,
    action: IAutoRule['action'],
    metrics: Record<MetricType, number>
  ): Promise<{ success: boolean; oldBudget?: number; newBudget?: number; error?: string }> {
    try {
      // 获取当前预算
      let currentBudget = 0
      
      if (level === 'campaign') {
        const campaign = await Campaign.findOne({ campaignId: entityId })
        currentBudget = (campaign?.raw as any)?.daily_budget / 100 || 0
      } else if (level === 'adset') {
        const adset = await AdSet.findOne({ adsetId: entityId })
        currentBudget = adset?.budget || (adset?.raw as any)?.daily_budget / 100 || 0
      } else {
        return { success: false, error: 'Budget adjustment only supports campaign and adset' }
      }
      
      if (currentBudget <= 0) {
        return { success: false, error: 'Current budget is 0 or not found' }
      }
      
      // 计算新预算
      let newBudget = currentBudget
      
      if (action.budgetChangePercent) {
        // 按百分比调整
        const multiplier = action.type === 'budget_up' 
          ? (1 + action.budgetChangePercent / 100)
          : (1 - action.budgetChangePercent / 100)
        newBudget = currentBudget * multiplier
      } else if (action.budgetChange) {
        // 按固定金额调整
        newBudget = action.type === 'budget_up'
          ? currentBudget + action.budgetChange
          : currentBudget - action.budgetChange
      } else {
        // 默认调整 20%
        const multiplier = action.type === 'budget_up' ? 1.2 : 0.8
        newBudget = currentBudget * multiplier
      }
      
      // 应用预算限制
      if (action.maxBudget && newBudget > action.maxBudget) {
        newBudget = action.maxBudget
      }
      if (action.minBudget && newBudget < action.minBudget) {
        newBudget = action.minBudget
      }
      
      // 确保预算至少 $1
      newBudget = Math.max(1, Math.round(newBudget * 100) / 100)
      
      // 如果预算没有变化，跳过
      if (Math.abs(newBudget - currentBudget) < 0.01) {
        return { success: false, error: 'Budget already at limit' }
      }
      
      // 更新预算
      if (level === 'campaign') {
        await updateCampaign({ token, campaignId: entityId, dailyBudget: newBudget })
      } else if (level === 'adset') {
        await updateAdSet({ token, adsetId: entityId, dailyBudget: newBudget })
        await AdSet.updateOne({ adsetId: entityId }, { budget: newBudget })
      }
      
      return { success: true, oldBudget: currentBudget, newBudget }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
  
  /**
   * 发送预警通知
   */
  private async sendAlert(
    rule: IAutoRule,
    entity: { id: string; name: string; accountId: string },
    metrics: Record<MetricType, number>
  ): Promise<void> {
    const message = {
      rule: rule.name,
      entity: entity.name,
      entityId: entity.id,
      metrics: {
        roas: metrics.roas.toFixed(2),
        spend: `$${metrics.spend.toFixed(2)}`,
        ctr: `${metrics.ctr.toFixed(2)}%`,
      },
      time: new Date().toISOString(),
    }
    
    // 如果配置了 Webhook，发送通知
    if (rule.action.notifyWebhook) {
      try {
        await fetch(rule.action.notifyWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'autoark_alert',
            ...message,
          }),
        })
        logger.info(`[RuleService] Webhook sent to ${rule.action.notifyWebhook}`)
      } catch (error: any) {
        logger.error(`[RuleService] Webhook failed: ${error.message}`)
      }
    }
    
    // TODO: 邮件通知
    if (rule.action.notifyEmail) {
      logger.info(`[RuleService] Email notification to ${rule.action.notifyEmail} (not implemented)`)
    }
  }
  
  /**
   * 执行所有激活的规则
   */
  async executeAllActiveRules(): Promise<void> {
    const activeRules = await AutoRule.find({ status: 'active' })
    
    logger.info(`[RuleService] Executing ${activeRules.length} active rules...`)
    
    for (const rule of activeRules) {
      try {
        await this.executeRule(rule._id.toString())
      } catch (error: any) {
        logger.error(`[RuleService] Failed to execute rule ${rule.name}: ${error.message}`)
      }
    }
  }
  
  /**
   * 获取预设规则模板
   */
  getTemplates(): Array<Partial<IAutoRule>> {
    return [
      {
        name: '自动关停低效广告',
        description: 'ROAS < 0.5 且消耗 > $30 的广告自动暂停',
        entityLevel: 'ad',
        conditions: [
          { metric: 'roas', operator: 'lt', value: 0.5, timeRange: 'last_3_days' },
          { metric: 'spend', operator: 'gt', value: 30, timeRange: 'last_3_days' },
        ],
        action: { type: 'auto_pause' },
        schedule: { type: 'hourly' },
        limits: { maxEntitiesPerExecution: 20, cooldownMinutes: 120 },
      },
      {
        name: '自动关停低效广告组',
        description: 'ROAS < 0.3 且消耗 > $100 的广告组自动暂停',
        entityLevel: 'adset',
        conditions: [
          { metric: 'roas', operator: 'lt', value: 0.3, timeRange: 'last_7_days' },
          { metric: 'spend', operator: 'gt', value: 100, timeRange: 'last_7_days' },
        ],
        action: { type: 'auto_pause' },
        schedule: { type: 'daily' },
        limits: { maxEntitiesPerExecution: 10, cooldownMinutes: 1440 },
      },
      {
        name: '低 CTR 广告预警',
        description: 'CTR < 1% 且展示 > 10000 的广告发送预警',
        entityLevel: 'ad',
        conditions: [
          { metric: 'ctr', operator: 'lt', value: 1, timeRange: 'last_3_days' },
          { metric: 'impressions', operator: 'gt', value: 10000, timeRange: 'last_3_days' },
        ],
        action: { type: 'alert' },
        schedule: { type: 'daily' },
        limits: { maxEntitiesPerExecution: 50 },
      },
      {
        name: '高 ROAS 自动扩量',
        description: 'ROAS > 2 且消耗 > $50 的广告组自动提升 20% 预算',
        entityLevel: 'adset',
        conditions: [
          { metric: 'roas', operator: 'gt', value: 2, timeRange: 'last_3_days' },
          { metric: 'spend', operator: 'gt', value: 50, timeRange: 'last_3_days' },
        ],
        action: { 
          type: 'budget_up',
          budgetChangePercent: 20,
          maxBudget: 500,  // 最高预算限制 $500
        },
        schedule: { type: 'daily' },
        limits: { maxEntitiesPerExecution: 10, cooldownMinutes: 1440 },
      },
      {
        name: '低 ROAS 自动降预算',
        description: 'ROAS < 0.8 且消耗 > $30 的广告组自动降低 30% 预算',
        entityLevel: 'adset',
        conditions: [
          { metric: 'roas', operator: 'lt', value: 0.8, timeRange: 'last_3_days' },
          { metric: 'spend', operator: 'gt', value: 30, timeRange: 'last_3_days' },
        ],
        action: { 
          type: 'budget_down',
          budgetChangePercent: 30,
          minBudget: 10,  // 最低预算限制 $10
        },
        schedule: { type: 'daily' },
        limits: { maxEntitiesPerExecution: 20, cooldownMinutes: 1440 },
      },
    ]
  }
}

export const ruleService = new RuleService()
export default ruleService
