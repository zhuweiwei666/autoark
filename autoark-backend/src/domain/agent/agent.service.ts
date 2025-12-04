import { GoogleGenerativeAI } from '@google/generative-ai'
import logger from '../../utils/logger'
import { AgentConfig, AgentOperation, DailyReport, AiConversation, CreativeScore } from './agent.model'
import Account from '../../models/Account'
import MetricsDaily from '../../models/MetricsDaily'
import Campaign from '../../models/Campaign'
import { updateCampaign, updateAdSet } from '../../integration/facebook/bulkCreate.api'
import FbToken from '../../models/FbToken'
import dayjs from 'dayjs'
import { fetchInsights } from '../../integration/facebook/insights.api'

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
          totalRevenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
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
          totalRevenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
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
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
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
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
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
   * AI 对话 - 增强版，获取所有投放数据
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

    // 获取完整的投放数据
    const allData = await this.getAllAdvertisingData()

    // 构建专业的广告优化师 prompt
    const systemPrompt = `你是 AutoArk 的 AI 广告投放优化顾问，专门服务于 Facebook/Meta 广告投放团队。

## 你的身份和能力
- 你是一位经验丰富的广告优化师，精通 Facebook 广告投放、数据分析和优化策略
- 你可以访问团队所有的投放数据，包括实时数据、历史数据、分投手数据、分国家数据
- 你可以分析广告表现，识别问题，给出优化建议

## 数据说明
- 投手识别规则：广告系列名称的第一个下划线前的字符串是投手名称（如 "yux_fb_xxx" 中的 "yux" 是投手）
- ROAS > 1 表示盈利，ROAS < 1 表示亏损
- CTR（点击率）、CPC（单次点击成本）、CPM（千次曝光成本）是重要的效率指标

## 当前数据快照

### 📊 今日实时数据（${dayjs().format('YYYY-MM-DD')}）
${JSON.stringify(allData.todaySummary, null, 2)}

### 📈 最近7天趋势
${JSON.stringify(allData.last7DaysTrend, null, 2)}

### 👥 分投手数据（今日）
${JSON.stringify(allData.optimizerData, null, 2)}

### 🌍 分国家数据（今日 Top 10）
${JSON.stringify(allData.countryData, null, 2)}

### 🏆 表现最佳的广告系列（今日 Top 10）
${JSON.stringify(allData.topCampaigns, null, 2)}

### ⚠️ 需要关注的广告系列（ROAS < 0.5 且消耗 > $20）
${JSON.stringify(allData.losingCampaigns, null, 2)}

### 📱 所有账户概况
${JSON.stringify(allData.accountsSummary, null, 2)}

## 历史对话
${conversation.messages.slice(-6).map((m: any) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`).join('\n')}

## 回答要求
1. 用中文回答，简洁专业
2. 如果涉及数据分析，引用具体数字
3. 给出可操作的建议
4. 如果数据不足以回答问题，说明需要什么数据`

    const prompt = `${systemPrompt}\n\n用户问题: ${message}`

    try {
      const result = await this.model.generateContent(prompt)
      const response = result.response.text()

      // 保存对话
      conversation.messages.push(
        { role: 'user', content: message, timestamp: new Date() },
        { role: 'assistant', content: response, timestamp: new Date(), dataUsed: allData }
      )
      await conversation.save()

      return response
    } catch (error: any) {
      logger.error('[AgentService] Chat failed:', error.message)
      return '抱歉，处理您的问题时遇到错误。请稍后再试。'
    }
  }

  /**
   * 获取所有广告投放数据
   */
  private async getAllAdvertisingData(): Promise<any> {
    const today = dayjs().format('YYYY-MM-DD')
    const sevenDaysAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const thirtyDaysAgo = dayjs().subtract(30, 'day').format('YYYY-MM-DD')

    // 获取所有账户
    const accounts = await Account.find().lean()
    const tokens = await FbToken.find({ status: 'active' }).lean()
    const token = tokens[0]?.token

    // 1. 今日实时数据 - 从 Facebook API 获取
    let todaySummary: any = { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0, purchase_value: 0, roas: 0 }
    
    if (token) {
      for (const account of accounts.slice(0, 10)) { // 限制账户数量避免超时
        try {
          const insights = await fetchInsights(
            `act_${account.accountId}`,
            'account',
            undefined,
            token,
            undefined,
            { since: today, until: today }
          )
          if (insights.length > 0) {
            const data = insights[0]
            todaySummary.spend += parseFloat(data.spend || '0')
            todaySummary.impressions += parseInt(data.impressions || '0', 10)
            todaySummary.clicks += parseInt(data.clicks || '0', 10)
            
            // 提取 purchase value
            if (data.action_values) {
              for (const av of data.action_values) {
                if (av.action_type === 'purchase' || av.action_type === 'omni_purchase') {
                  todaySummary.purchase_value += parseFloat(av.value || '0')
                }
              }
            }
          }
        } catch (e) {
          // 继续
        }
      }
      
      // 计算派生指标
      if (todaySummary.impressions > 0) {
        todaySummary.ctr = (todaySummary.clicks / todaySummary.impressions * 100).toFixed(2) + '%'
        todaySummary.cpm = '$' + (todaySummary.spend / todaySummary.impressions * 1000).toFixed(2)
      }
      if (todaySummary.clicks > 0) {
        todaySummary.cpc = '$' + (todaySummary.spend / todaySummary.clicks).toFixed(2)
      }
      if (todaySummary.spend > 0) {
        todaySummary.roas = (todaySummary.purchase_value / todaySummary.spend).toFixed(2)
      }
      todaySummary.spend = '$' + todaySummary.spend.toFixed(2)
      todaySummary.purchase_value = '$' + todaySummary.purchase_value.toFixed(2)
    }

    // 2. 最近7天趋势
    const last7DaysTrend = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          date: { $gte: sevenDaysAgo, $lte: today }
        }
      },
      {
        $group: {
          _id: '$date',
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          date: '$_id',
          spend: { $round: ['$spend', 2] },
          revenue: { $round: ['$revenue', 2] },
          roas: {
            $round: [
              { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
              2
            ]
          },
          impressions: 1,
          clicks: 1,
        }
      }
    ])

    // 3. 分投手数据（从 campaign name 提取）
    const campaignsWithMetrics = await Campaign.aggregate([
      {
        $lookup: {
          from: 'metricsdailies',
          let: { cid: '$campaignId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$campaignId', '$$cid'] },
                date: today
              }
            }
          ],
          as: 'todayMetrics'
        }
      },
      { $unwind: { path: '$todayMetrics', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          campaignId: 1,
          name: 1,
          optimizer: {
            $arrayElemAt: [{ $split: ['$name', '_'] }, 0]
          },
          spend: { $ifNull: ['$todayMetrics.spendUsd', 0] },
          revenue: { $ifNull: ['$todayMetrics.purchase_value', 0] },
          impressions: { $ifNull: ['$todayMetrics.impressions', 0] },
          clicks: { $ifNull: ['$todayMetrics.clicks', 0] },
        }
      },
      {
        $group: {
          _id: '$optimizer',
          totalSpend: { $sum: '$spend' },
          totalRevenue: { $sum: '$revenue' },
          totalImpressions: { $sum: '$impressions' },
          totalClicks: { $sum: '$clicks' },
          campaignCount: { $sum: 1 },
        }
      },
      {
        $project: {
          optimizer: '$_id',
          spend: { $round: ['$totalSpend', 2] },
          revenue: { $round: ['$totalRevenue', 2] },
          roas: {
            $round: [
              { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] },
              2
            ]
          },
          impressions: '$totalImpressions',
          clicks: '$totalClicks',
          campaignCount: 1,
        }
      },
      { $match: { spend: { $gt: 0 } } },
      { $sort: { spend: -1 } },
      { $limit: 10 }
    ])

    // 4. 分国家数据
    const countryData = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          date: today,
          country: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$country',
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
        }
      },
      {
        $project: {
          country: '$_id',
          spend: { $round: ['$spend', 2] },
          revenue: { $round: ['$revenue', 2] },
          roas: {
            $round: [
              { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
              2
            ]
          },
          impressions: 1,
          clicks: 1,
        }
      },
      { $sort: { spend: -1 } },
      { $limit: 10 }
    ])

    // 5. 表现最佳的广告系列
    const topCampaigns = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          date: today
        }
      },
      {
        $group: {
          _id: '$campaignId',
          name: { $first: '$campaignName' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
        }
      },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          optimizer: { $arrayElemAt: [{ $split: ['$name', '_'] }, 0] }
        }
      },
      { $match: { spend: { $gt: 5 } } },
      { $sort: { roas: -1 } },
      { $limit: 10 },
      {
        $project: {
          name: 1,
          optimizer: 1,
          spend: { $round: ['$spend', 2] },
          revenue: { $round: ['$revenue', 2] },
          roas: { $round: ['$roas', 2] },
        }
      }
    ])

    // 6. 亏损广告系列
    const losingCampaigns = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          date: today
        }
      },
      {
        $group: {
          _id: '$campaignId',
          name: { $first: '$campaignName' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
        }
      },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          optimizer: { $arrayElemAt: [{ $split: ['$name', '_'] }, 0] }
        }
      },
      { $match: { spend: { $gt: 20 }, roas: { $lt: 0.5 } } },
      { $sort: { spend: -1 } },
      { $limit: 10 },
      {
        $project: {
          name: 1,
          optimizer: 1,
          spend: { $round: ['$spend', 2] },
          revenue: { $round: ['$revenue', 2] },
          roas: { $round: ['$roas', 2] },
          loss: { $round: [{ $subtract: ['$spend', '$revenue'] }, 2] }
        }
      }
    ])

    // 7. 账户概况
    const accountsSummary = accounts.slice(0, 10).map(a => ({
      name: a.name,
      accountId: a.accountId,
      status: a.status,
      balance: a.balance,
      amountSpent: a.amountSpent,
    }))

    return {
      todaySummary,
      last7DaysTrend,
      optimizerData: campaignsWithMetrics,
      countryData,
      topCampaigns,
      losingCampaigns,
      accountsSummary,
      dataTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    }
  }

  // ==================== 健康度分析 ====================

  /**
   * 获取账户健康度分析
   */
  async analyzeHealth(accountId?: string): Promise<any> {
    const today = dayjs().format('YYYY-MM-DD')
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const sevenDaysAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    const matchQuery: any = { campaignId: { $exists: true, $ne: null } }
    if (accountId) matchQuery.accountId = accountId

    // 今日数据
    const todayMetrics = await MetricsDaily.aggregate([
      { $match: { ...matchQuery, date: today } },
      {
        $group: {
          _id: null,
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          campaigns: { $addToSet: '$campaignId' }
        }
      }
    ])

    // 昨日数据
    const yesterdayMetrics = await MetricsDaily.aggregate([
      { $match: { ...matchQuery, date: yesterday } },
      {
        $group: {
          _id: null,
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
        }
      }
    ])

    // 7天平均
    const weekMetrics = await MetricsDaily.aggregate([
      { $match: { ...matchQuery, date: { $gte: sevenDaysAgo, $lte: today } } },
      {
        $group: {
          _id: null,
          avgSpend: { $avg: '$spendUsd' },
          avgRevenue: { $avg: { $ifNull: ['$purchase_value', 0] } },
        }
      }
    ])

    const todayData = todayMetrics[0] || { spend: 0, revenue: 0, impressions: 0, clicks: 0, campaigns: [] }
    const yesterdayData = yesterdayMetrics[0] || { spend: 0, revenue: 0 }
    const weekData = weekMetrics[0] || { avgSpend: 0, avgRevenue: 0 }

    const todayRoas = todayData.spend > 0 ? todayData.revenue / todayData.spend : 0
    const yesterdayRoas = yesterdayData.spend > 0 ? yesterdayData.revenue / yesterdayData.spend : 0
    const weekAvgRoas = weekData.avgSpend > 0 ? weekData.avgRevenue / weekData.avgSpend : 0

    // 计算健康度评分
    let score = 100
    const issues: string[] = []
    const suggestions: string[] = []

    // ROAS 评估
    if (todayRoas < 0.5) {
      score -= 30
      issues.push(`今日 ROAS 过低 (${todayRoas.toFixed(2)})`)
      suggestions.push('检查亏损广告系列，考虑暂停或降低预算')
    } else if (todayRoas < 1) {
      score -= 15
      issues.push(`今日 ROAS 低于盈亏平衡点 (${todayRoas.toFixed(2)})`)
    }

    // ROAS 变化
    if (yesterdayRoas > 0 && todayRoas < yesterdayRoas * 0.7) {
      score -= 20
      issues.push(`ROAS 较昨日下降 ${((1 - todayRoas / yesterdayRoas) * 100).toFixed(1)}%`)
      suggestions.push('分析下降原因，检查是否有异常广告系列')
    }

    // 消耗异常
    if (weekData.avgSpend > 0 && todayData.spend > weekData.avgSpend * 2) {
      score -= 10
      issues.push(`今日消耗异常高，是7日均值的 ${(todayData.spend / weekData.avgSpend).toFixed(1)} 倍`)
      suggestions.push('检查是否有预算设置错误或突发流量')
    }

    return {
      score: Math.max(0, score),
      status: score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical',
      metrics: {
        todaySpend: todayData.spend,
        todayRevenue: todayData.revenue,
        todayRoas,
        yesterdayRoas,
        weekAvgRoas,
        activeCampaigns: todayData.campaigns?.length || 0,
      },
      issues,
      suggestions,
      analyzedAt: new Date(),
    }
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
          totalRevenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          days: { $addToSet: '$date' },
          dailyData: {
            $push: {
              date: '$date',
              spend: '$spendUsd',
              revenue: { $ifNull: ['$purchase_value', 0] },
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
