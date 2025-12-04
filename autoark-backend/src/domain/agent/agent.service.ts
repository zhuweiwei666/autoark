import { GoogleGenerativeAI } from '@google/generative-ai'
import logger from '../../utils/logger'
import { AgentConfig, AgentOperation, DailyReport, AiConversation, CreativeScore } from './agent.model'
import Account from '../../models/Account'
import MetricsDaily from '../../models/MetricsDaily'
import Campaign from '../../models/Campaign'
import { updateCampaign, updateAdSet } from '../../integration/facebook/bulkCreate.api'
import FbToken from '../../models/FbToken'

const LLM_API_KEY = process.env.LLM_API_KEY
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-2.0-flash'

/**
 * AI Agent 核心服务
 */
class AgentService {
  private model: any = null

  constructor() {
    if (LLM_API_KEY) {
      const genAI = new GoogleGenerativeAI(LLM_API_KEY)
      this.model = genAI.getGenerativeModel({ model: LLM_MODEL })
      logger.info(`[AgentService] Initialized with model: ${LLM_MODEL}`)
    } else {
      logger.warn('[AgentService] LLM_API_KEY not configured')
    }
  }

  // ==================== Agent 配置管理 ====================

  async createAgent(data: any) {
    const agent = new AgentConfig(data)
    await agent.save()
    logger.info(`[AgentService] Created agent: ${agent.name}`)
    return agent
  }

  async getAgents(filters: any = {}) {
    return AgentConfig.find(filters).sort({ createdAt: -1 })
  }

  async getAgentById(id: string) {
    return AgentConfig.findById(id)
  }

  async updateAgent(id: string, data: any) {
    return AgentConfig.findByIdAndUpdate(id, data, { new: true })
  }

  async deleteAgent(id: string) {
    return AgentConfig.findByIdAndDelete(id)
  }

  // ==================== 智能报告生成 ====================

  /**
   * 生成每日报告
   */
  async generateDailyReport(date: string, accountId?: string): Promise<any> {
    logger.info(`[AgentService] Generating daily report for ${date}, account: ${accountId || 'all'}`)

    // 获取数据
    const query: any = { date }
    if (accountId) query.accountId = accountId

    // 聚合当日数据
    const metricsData = await MetricsDaily.aggregate([
      { $match: { ...query, campaignId: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: accountId ? '$accountId' : null,
          totalSpend: { $sum: '$spendUsd' },
          totalRevenue: { $sum: { $ifNull: ['$purchaseValue', 0] } },
          totalImpressions: { $sum: '$impressions' },
          totalClicks: { $sum: '$clicks' },
          campaigns: { $addToSet: '$campaignId' },
        }
      }
    ])

    const todayData = metricsData[0] || {
      totalSpend: 0,
      totalRevenue: 0,
      totalImpressions: 0,
      totalClicks: 0,
      campaigns: [],
    }

    // 获取前一天数据用于对比
    const yesterday = new Date(date)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    const yesterdayData = await MetricsDaily.aggregate([
      { $match: { date: yesterdayStr, campaignId: { $exists: true, $ne: null }, ...(accountId ? { accountId } : {}) } },
      {
        $group: {
          _id: null,
          totalSpend: { $sum: '$spendUsd' },
          totalRevenue: { $sum: { $ifNull: ['$purchaseValue', 0] } },
        }
      }
    ])

    const prevData = yesterdayData[0] || { totalSpend: 0, totalRevenue: 0 }

    // 计算趋势
    const avgRoas = todayData.totalSpend > 0 ? todayData.totalRevenue / todayData.totalSpend : 0
    const prevRoas = prevData.totalSpend > 0 ? prevData.totalRevenue / prevData.totalSpend : 0

    const trends = {
      spendChange: prevData.totalSpend > 0 ? ((todayData.totalSpend - prevData.totalSpend) / prevData.totalSpend * 100) : 0,
      roasChange: prevRoas > 0 ? ((avgRoas - prevRoas) / prevRoas * 100) : 0,
      revenueChange: prevData.totalRevenue > 0 ? ((todayData.totalRevenue - prevData.totalRevenue) / prevData.totalRevenue * 100) : 0,
    }

    // 获取表现最好的广告系列
    const topCampaigns = await MetricsDaily.aggregate([
      { $match: { date, campaignId: { $exists: true, $ne: null }, ...(accountId ? { accountId } : {}) } },
      {
        $group: {
          _id: '$campaignId',
          name: { $first: '$campaignName' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchaseValue', 0] } },
        }
      },
      { $addFields: { roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] } } },
      { $match: { spend: { $gt: 10 } } },
      { $sort: { roas: -1 } },
      { $limit: 5 }
    ])

    // 检测异常
    const alerts: any[] = []

    // ROAS 下降告警
    if (trends.roasChange < -30 && prevRoas > 0.5) {
      alerts.push({
        type: 'roas_drop',
        severity: trends.roasChange < -50 ? 'critical' : 'warning',
        message: `ROAS 下降 ${Math.abs(trends.roasChange).toFixed(1)}%`,
        value: avgRoas,
        threshold: prevRoas,
      })
    }

    // 消耗暴涨告警
    if (trends.spendChange > 50 && todayData.totalSpend > 100) {
      alerts.push({
        type: 'spend_spike',
        severity: 'warning',
        message: `消耗上涨 ${trends.spendChange.toFixed(1)}%`,
        value: todayData.totalSpend,
        threshold: prevData.totalSpend,
      })
    }

    // 识别需要关注的广告系列 (亏损)
    const losingCampaigns = await MetricsDaily.aggregate([
      { $match: { date, campaignId: { $exists: true, $ne: null }, ...(accountId ? { accountId } : {}) } },
      {
        $group: {
          _id: '$campaignId',
          name: { $first: '$campaignName' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchaseValue', 0] } },
        }
      },
      { $addFields: { roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] } } },
      { $match: { spend: { $gt: 20 }, roas: { $lt: 0.5 } } },
      { $sort: { spend: -1 } },
      { $limit: 5 }
    ])

    const needsAttention = losingCampaigns.map((c: any) => ({
      entityType: 'campaign',
      entityId: c._id,
      entityName: c.name,
      issue: `ROAS 仅 ${c.roas.toFixed(2)}，已花费 $${c.spend.toFixed(2)}`,
      suggestion: '建议降低预算或暂停',
    }))

    // 使用 AI 生成摘要
    let aiSummary = ''
    let aiRecommendations: string[] = []

    if (this.model) {
      try {
        const aiResult = await this.generateAiSummary({
          date,
          summary: {
            totalSpend: todayData.totalSpend,
            totalRevenue: todayData.totalRevenue,
            avgRoas,
            activeCampaigns: todayData.campaigns?.length || 0,
          },
          trends,
          alerts,
          topPerformers: topCampaigns,
          needsAttention,
        })
        aiSummary = aiResult.summary
        aiRecommendations = aiResult.recommendations
      } catch (error: any) {
        logger.error('[AgentService] AI summary generation failed:', error.message)
      }
    }

    // 保存报告
    const report = await DailyReport.findOneAndUpdate(
      { date, accountId: accountId || null },
      {
        date,
        accountId,
        summary: {
          totalSpend: todayData.totalSpend,
          totalRevenue: todayData.totalRevenue,
          avgRoas,
          activeCampaigns: todayData.campaigns?.length || 0,
          profitableCampaigns: topCampaigns.filter((c: any) => c.roas > 1).length,
          losingCampaigns: losingCampaigns.length,
        },
        trends,
        alerts,
        topPerformers: topCampaigns.map((c: any) => ({
          entityType: 'campaign',
          entityId: c._id,
          entityName: c.name,
          roas: c.roas,
          spend: c.spend,
          revenue: c.revenue,
        })),
        needsAttention,
        aiSummary,
        aiRecommendations,
        status: 'ready',
      },
      { upsert: true, new: true }
    )

    logger.info(`[AgentService] Daily report generated: ${report._id}`)
    return report
  }

  /**
   * AI 生成报告摘要
   */
  private async generateAiSummary(data: any): Promise<{ summary: string; recommendations: string[] }> {
    const prompt = `作为一个专业的 Facebook 广告投放分析师，请分析以下数据并给出摘要和建议：

日期: ${data.date}

今日数据:
- 总消耗: $${data.summary.totalSpend.toFixed(2)}
- 总收入: $${data.summary.totalRevenue.toFixed(2)}
- 平均 ROAS: ${data.summary.avgRoas.toFixed(2)}
- 活跃广告系列: ${data.summary.activeCampaigns}

趋势变化 (对比昨天):
- 消耗变化: ${data.trends.spendChange.toFixed(1)}%
- ROAS 变化: ${data.trends.roasChange.toFixed(1)}%
- 收入变化: ${data.trends.revenueChange?.toFixed(1) || 0}%

告警: ${data.alerts.length > 0 ? data.alerts.map((a: any) => a.message).join(', ') : '无'}

表现最好的广告系列:
${data.topPerformers.map((c: any) => `- ${c.name || c._id}: ROAS ${c.roas.toFixed(2)}, 消耗 $${c.spend.toFixed(2)}`).join('\n')}

需要关注:
${data.needsAttention.map((c: any) => `- ${c.entityName || c.entityId}: ${c.issue}`).join('\n') || '无'}

请返回 JSON 格式 (不要 Markdown):
{
  "summary": "一段话总结今日投放表现（中文，50-100字）",
  "recommendations": ["建议1", "建议2", "建议3"]
}`

    const result = await this.model.generateContent(prompt)
    const content = result.response.text()
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    
    return {
      summary: '报告生成中，请稍后查看。',
      recommendations: [],
    }
  }

  // ==================== AI 对话问答 ====================

  /**
   * AI 对话
   */
  async chat(userId: string, message: string, context?: any): Promise<string> {
    if (!this.model) {
      return '抱歉，AI 服务暂时不可用。请稍后再试。'
    }

    // 获取或创建会话
    let conversation = await AiConversation.findOne({
      userId,
      status: 'active',
      'context.accountId': context?.accountId,
    }).sort({ createdAt: -1 })

    if (!conversation) {
      conversation = new AiConversation({
        userId,
        context,
        messages: [],
      })
    }

    // 获取相关数据
    const relevantData = await this.getRelevantData(message, context)

    // 构建 prompt
    const systemPrompt = `你是 AutoArk 的 AI 广告投放助手。你可以帮助用户分析广告数据、解答投放问题、给出优化建议。

当前上下文数据:
${JSON.stringify(relevantData, null, 2)}

历史对话:
${conversation.messages.slice(-10).map((m: any) => `${m.role}: ${m.content}`).join('\n')}

请用中文回答用户的问题。如果需要查看具体数据，请指出需要什么数据。回答要简洁专业。`

    const prompt = `${systemPrompt}\n\n用户: ${message}`

    try {
      const result = await this.model.generateContent(prompt)
      const response = result.response.text()

      // 保存对话
      conversation.messages.push(
        { role: 'user', content: message, timestamp: new Date() },
        { role: 'assistant', content: response, timestamp: new Date(), dataUsed: relevantData }
      )
      await conversation.save()

      return response
    } catch (error: any) {
      logger.error('[AgentService] Chat failed:', error.message)
      return '抱歉，处理您的问题时遇到错误。请稍后再试。'
    }
  }

  /**
   * 获取与问题相关的数据
   */
  private async getRelevantData(message: string, context?: any): Promise<any> {
    const data: any = {}

    // 获取账户汇总
    if (context?.accountId) {
      const account = await Account.findOne({ accountId: context.accountId })
      if (account) {
        data.account = {
          name: account.name,
          status: account.status,
          amountSpent: account.amountSpent,
          balance: account.balance,
        }
      }

      // 获取最近 7 天数据
      const last7Days = await MetricsDaily.aggregate([
        {
          $match: {
            accountId: context.accountId,
            campaignId: { $exists: true, $ne: null },
            date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] }
          }
        },
        {
          $group: {
            _id: '$date',
            spend: { $sum: '$spendUsd' },
            revenue: { $sum: { $ifNull: ['$purchaseValue', 0] } },
            impressions: { $sum: '$impressions' },
            clicks: { $sum: '$clicks' },
          }
        },
        { $sort: { _id: -1 } }
      ])
      data.last7Days = last7Days
    }

    // 如果问到特定广告系列
    if (context?.campaignId) {
      const campaignData = await MetricsDaily.find({
        campaignId: context.campaignId,
      }).sort({ date: -1 }).limit(7)
      data.campaignData = campaignData
    }

    return data
  }

  // ==================== 自动优化执行 ====================

  /**
   * 运行 Agent 检查和优化
   */
  async runAgent(agentId: string): Promise<any> {
    const agent: any = await AgentConfig.findById(agentId)
    if (!agent || agent.status !== 'active') {
      return { success: false, message: 'Agent not active' }
    }

    logger.info(`[AgentService] Running agent: ${agent.name}`)

    const operations: any[] = []
    const accounts = agent.accountIds?.length > 0
      ? await Account.find({ accountId: { $in: agent.accountIds } })
      : await Account.find({ status: 'active' })

    for (const account of accounts) {
      // 获取该账户的广告系列表现
      const campaignPerformance = await this.getCampaignPerformance(account.accountId, 7)

      for (const campaign of campaignPerformance) {
        // 检查自动关停规则
        if (agent.rules.autoStop.enabled) {
          const stopOp = await this.checkAutoStop(agent, campaign)
          if (stopOp) operations.push(stopOp)
        }

        // 检查自动扩量规则
        if (agent.rules.autoScale.enabled) {
          const scaleOp = await this.checkAutoScale(agent, campaign)
          if (scaleOp) operations.push(scaleOp)
        }
      }
    }

    // 根据模式处理操作
    if (agent.mode === 'observe') {
      // 仅记录，不执行
      for (const op of operations) {
        op.status = 'pending'
        await new AgentOperation(op).save()
      }
    } else if (agent.mode === 'suggest') {
      // 记录并通知
      for (const op of operations) {
        op.status = 'pending'
        const saved = await new AgentOperation(op).save()
        // TODO: 发送通知
      }
    } else if (agent.mode === 'auto') {
      // 自动执行
      for (const op of operations) {
        if (agent.aiConfig.requireApproval && this.needsApproval(op, agent)) {
          op.status = 'pending'
          await new AgentOperation(op).save()
        } else {
          await this.executeOperation(op)
        }
      }
    }

    return {
      success: true,
      operationsCount: operations.length,
      operations: operations.map(o => ({ action: o.action, entityId: o.entityId, reason: o.reason })),
    }
  }

  /**
   * 获取广告系列表现数据
   */
  private async getCampaignPerformance(accountId: string, days: number): Promise<any[]> {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    return MetricsDaily.aggregate([
      {
        $match: {
          accountId,
          campaignId: { $exists: true, $ne: null },
          date: { $gte: startDate.toISOString().split('T')[0] }
        }
      },
      {
        $group: {
          _id: '$campaignId',
          campaignName: { $first: '$campaignName' },
          accountId: { $first: '$accountId' },
          totalSpend: { $sum: '$spendUsd' },
          totalRevenue: { $sum: { $ifNull: ['$purchaseValue', 0] } },
          days: { $addToSet: '$date' },
          dailyData: {
            $push: {
              date: '$date',
              spend: '$spendUsd',
              revenue: { $ifNull: ['$purchaseValue', 0] },
            }
          }
        }
      },
      {
        $addFields: {
          avgRoas: { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] },
          daysCount: { $size: '$days' },
        }
      }
    ])
  }

  /**
   * 检查是否需要自动关停
   */
  private async checkAutoStop(agent: any, campaign: any): Promise<any | null> {
    const rules = agent.rules.autoStop
    
    if (campaign.avgRoas < rules.roasThreshold &&
        campaign.daysCount >= rules.minDays &&
        campaign.totalSpend >= rules.minSpend) {
      return {
        agentId: agent._id,
        accountId: campaign.accountId,
        entityType: 'campaign',
        entityId: campaign._id,
        entityName: campaign.campaignName,
        action: 'pause',
        beforeValue: { status: 'ACTIVE' },
        afterValue: { status: 'PAUSED' },
        reason: `ROAS ${campaign.avgRoas.toFixed(2)} < ${rules.roasThreshold}，连续 ${campaign.daysCount} 天，总消耗 $${campaign.totalSpend.toFixed(2)}`,
        dataSnapshot: campaign,
      }
    }
    return null
  }

  /**
   * 检查是否需要自动扩量
   */
  private async checkAutoScale(agent: any, campaign: any): Promise<any | null> {
    const rules = agent.rules.autoScale
    
    if (campaign.avgRoas > rules.roasThreshold &&
        campaign.daysCount >= rules.minDays) {
      // 获取当前预算
      const campaignDoc = await Campaign.findOne({ campaignId: campaign._id })
      const currentBudget = parseFloat(campaignDoc?.daily_budget || '0') || 0
      const newBudget = currentBudget * (1 + rules.budgetIncrease)
      
      // 检查最大预算限制
      if (rules.maxBudget && newBudget > rules.maxBudget) {
        return null
      }

      return {
        agentId: agent._id,
        accountId: campaign.accountId,
        entityType: 'campaign',
        entityId: campaign._id,
        entityName: campaign.campaignName,
        action: 'budget_increase',
        beforeValue: { budget: currentBudget },
        afterValue: { budget: newBudget },
        changePercent: rules.budgetIncrease * 100,
        reason: `ROAS ${campaign.avgRoas.toFixed(2)} > ${rules.roasThreshold}，连续 ${campaign.daysCount} 天表现优秀`,
        dataSnapshot: campaign,
      }
    }
    return null
  }

  /**
   * 判断是否需要人工审批
   */
  private needsApproval(operation: any, agent: any): boolean {
    // 关停操作始终需要审批
    if (operation.action === 'pause') return true
    
    // 预算变化超过阈值需要审批
    if (operation.action === 'budget_increase' || operation.action === 'budget_decrease') {
      const changeAmount = Math.abs(operation.afterValue.budget - operation.beforeValue.budget)
      if (changeAmount > agent.aiConfig.approvalThreshold) return true
    }
    
    return false
  }

  /**
   * 执行操作
   */
  async executeOperation(operationId: string): Promise<any> {
    const operation: any = await AgentOperation.findById(operationId)
    if (!operation) {
      return { success: false, error: 'Operation not found' }
    }

    const token = await FbToken.findOne({ status: 'active' })
    if (!token) {
      operation.status = 'failed'
      operation.error = 'No active token'
      await operation.save()
      return { success: false, error: 'No active token' }
    }

    try {
      let result
      
      if (operation.entityType === 'campaign') {
        if (operation.action === 'pause') {
          result = await updateCampaign({
            campaignId: operation.entityId,
            token: token.token,
            status: 'PAUSED',
          })
        } else if (operation.action === 'budget_increase' || operation.action === 'budget_decrease') {
          result = await updateCampaign({
            campaignId: operation.entityId,
            token: token.token,
            dailyBudget: operation.afterValue.budget,
          })
        }
      }

      operation.status = 'executed'
      operation.executedAt = new Date()
      operation.executedBy = 'system'
      operation.result = result
      await operation.save()

      logger.info(`[AgentService] Operation executed: ${operation._id}`)
      return { success: true, result }
    } catch (error: any) {
      operation.status = 'failed'
      operation.error = error.message
      await operation.save()
      
      logger.error(`[AgentService] Operation failed: ${operation._id}`, error)
      return { success: false, error: error.message }
    }
  }

  // ==================== 素材评分 ====================

  /**
   * 计算素材评分
   */
  async scoreCreatives(creativeGroupId?: string): Promise<any[]> {
    // 获取素材表现数据
    const match: any = {}
    if (creativeGroupId) match.creativeGroupId = creativeGroupId

    // TODO: 实现素材到广告表现的关联
    // 这需要在广告创建时记录使用的素材信息

    const scores: any[] = []
    
    // 简化实现：基于已有数据生成评分
    // 实际生产中需要关联 Ad -> Creative -> Material
    
    return scores
  }

  // ==================== 告警通知 ====================

  /**
   * 发送告警通知
   */
  async sendAlert(agent: any, alert: any): Promise<void> {
    if (!agent.alerts.enabled) return

    for (const channel of agent.alerts.channels) {
      try {
        if (channel.type === 'webhook') {
          await this.sendWebhook(channel.config.url, alert)
        } else if (channel.type === 'dingtalk') {
          await this.sendDingTalk(channel.config, alert)
        }
        // TODO: 其他通知渠道
      } catch (error) {
        logger.error(`[AgentService] Failed to send alert via ${channel.type}:`, error)
      }
    }
  }

  private async sendWebhook(url: string, data: any): Promise<void> {
    const axios = require('axios')
    await axios.post(url, data, { timeout: 10000 })
  }

  private async sendDingTalk(config: any, alert: any): Promise<void> {
    const axios = require('axios')
    const message = {
      msgtype: 'markdown',
      markdown: {
        title: `⚠️ AutoArk 告警`,
        text: `### ${alert.type}\n\n${alert.message}\n\n- 严重程度: ${alert.severity}\n- 当前值: ${alert.value}\n- 阈值: ${alert.threshold}`
      }
    }
    await axios.post(config.webhook, message, { timeout: 10000 })
  }

  // ==================== 获取待审批操作 ====================

  async getPendingOperations(filters: any = {}): Promise<any[]> {
    return AgentOperation.find({ status: 'pending', ...filters })
      .populate('agentId')
      .sort({ createdAt: -1 })
  }

  async approveOperation(operationId: string, userId: string): Promise<any> {
    const operation: any = await AgentOperation.findById(operationId)
    if (!operation) {
      return { success: false, error: 'Operation not found' }
    }
    
    operation.status = 'approved'
    await operation.save()
    
    // 执行操作
    return this.executeOperation(operationId)
  }

  async rejectOperation(operationId: string, userId: string, reason?: string): Promise<any> {
    return AgentOperation.findByIdAndUpdate(operationId, {
      status: 'rejected',
      executedBy: userId,
      error: reason || 'Rejected by user',
    }, { new: true })
  }
}

export const agentService = new AgentService()

