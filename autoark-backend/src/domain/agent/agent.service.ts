import { GoogleGenerativeAI } from '@google/generative-ai'
import logger from '../../utils/logger'
import { AgentConfig, AgentOperation, DailyReport, AiConversation, CreativeScore } from './agent.model'
import Account from '../../models/Account'
import MetricsDaily from '../../models/MetricsDaily'
import Campaign from '../../models/Campaign'
import MaterialMetrics from '../../models/MaterialMetrics'
import { updateCampaign, updateAdSet } from '../../integration/facebook/bulkCreate.api'
import FbToken from '../../models/FbToken'
import dayjs from 'dayjs'
import { scoringService, MetricData, MetricSequence } from './analytics/scoring.service'
import { trendService } from './analytics/trend.service'
import { fetchInsights } from '../../integration/facebook/insights.api'
import { createAutomationJob } from '../../services/automationJob.service'
import { getMaterialRankings } from '../../services/materialMetrics.service'
import { getCoreMetrics } from '../../services/dashboard.service'
import { facebookClient } from '../../integration/facebook/facebookClient'
import { feishuService } from '../../services/feishu.service'
import { momentumService } from './executor/momentum.service'
// 🔥 使用统一的预聚合数据表
import { 
  AggDaily, 
  AggCountry, 
  AggAccount, 
  AggCampaign, 
  AggOptimizer 
} from '../../models/Aggregation'
// 🚫 不再在 AI 对话中刷新数据，由后台 cron 统一刷新
// import { refreshRecentDays } from '../../services/aggregation.service'

const LLM_API_KEY = process.env.LLM_API_KEY
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-2.0-flash'

/**
 * AI Agent 核心服务
 */
class AgentService {
  private model: any = null
  private tokenAccessCache = new Map<string, boolean>()

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
   * 🔥 从预聚合表获取数据（简洁高效）
   * 最近3天实时刷新，历史数据从数据库读取
   */
  private async getAggregatedData(): Promise<any> {
    const today = dayjs().format('YYYY-MM-DD')
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const sevenDaysAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

    // ⚡ 不再实时刷新，直接读取预聚合表（数据由后台 cron 每 10 分钟更新）
    logger.info('[AgentService] Reading from Aggregation tables (no refresh)...')

    // 并行获取所有预聚合数据
    const [
      todaySummary,
      yesterdaySummary,
      weekTrend,
      countries,
      accounts,
      campaigns,
      optimizers,
    ] = await Promise.all([
      AggDaily.findOne({ date: today }).lean(),
      AggDaily.findOne({ date: yesterday }).lean(),
      AggDaily.find({ date: { $gte: sevenDaysAgo } }).sort({ date: 1 }).lean(),
      AggCountry.find({ date: today }).sort({ spend: -1 }).limit(20).lean(),
      AggAccount.find({ date: today }).sort({ spend: -1 }).lean(),
      AggCampaign.find({ date: today, spend: { $gt: 1 } }).sort({ spend: -1 }).limit(50).lean(),
      AggOptimizer.find({ date: today }).sort({ spend: -1 }).lean(),
    ])

    // 获取素材数据
    const materialMetrics = await getMaterialRankings({
      dateRange: { start: sevenDaysAgo, end: today },
      limit: 20,
    })

    return {
      dataTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      dateRange: { today, yesterday, sevenDaysAgo },
      todaySummary: todaySummary || { spend: 0, revenue: 0, roas: 0 },
      yesterdaySummary: yesterdaySummary || { spend: 0, revenue: 0, roas: 0 },
      weekTrend,
      countries,
      accounts,
      campaigns,
      optimizers,
      materialMetrics: {
        topMaterials: materialMetrics.filter((m: any) => m.roas >= 1).slice(0, 10),
        losingMaterials: materialMetrics.filter((m: any) => m.roas < 0.5 && m.spend > 20).slice(0, 10),
      },
    }
  }

  /**
   * AI 对话 - 使用预聚合数据，响应更快更准确
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

    // 🔥 使用预聚合数据（更快更准确）
    const allData = await this.getAggregatedData()

    // 🔥 使用预聚合数据构建简洁的 prompt
    const systemPrompt = `你是 AutoArk 的 AI 广告投放优化顾问，专门服务于 Facebook/Meta 广告投放团队。

## 你的身份和能力
- 你是一位经验丰富的广告优化师，精通 Facebook 广告投放、数据分析和优化策略
- 你可以访问团队所有的投放数据（来自预聚合表，数据准确）
- 你可以分析广告表现，识别问题，给出优化建议

## 数据说明
- ROAS > 1 表示盈利，ROAS < 1 表示亏损
- 投手识别规则：广告系列名称的第一个下划线前的字符串是投手名称
- 数据更新时间：${allData.dataTime}

## 📊 今日数据（${allData.dateRange?.today}）
${JSON.stringify(allData.todaySummary, null, 2)}

## 📊 昨日数据（${allData.dateRange?.yesterday}）
${JSON.stringify(allData.yesterdaySummary, null, 2)}

## 📈 最近7天趋势
${JSON.stringify(allData.weekTrend, null, 2)}

## 🌍 分国家数据（今日）
${JSON.stringify(allData.countries, null, 2)}

## 💰 分账户数据（今日）
${JSON.stringify(allData.accounts, null, 2)}

## 📋 广告系列数据（今日消耗 > $1）
${JSON.stringify(allData.campaigns?.slice(0, 30), null, 2)}

## 👥 分投手数据（今日）
${JSON.stringify(allData.optimizers, null, 2)}

## 🎨 素材数据（最近7天）

### 表现最佳的素材
${JSON.stringify(allData.materialMetrics?.topMaterials || [], null, 2)}

### 需要关注的素材（高消耗低ROAS）
${JSON.stringify(allData.materialMetrics?.losingMaterials || [], null, 2)}

#### 素材类型统计（图片 vs 视频）
${JSON.stringify(allData.materialMetrics?.materialTypeStats || [], null, 2)}

## 历史对话
${conversation.messages.slice(-6).map((m: any) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`).join('\n')}

## 回答要求
1. 用中文回答，简洁专业
2. 如果涉及数据分析，必须引用具体数字
3. 可以对比不同时期（今日vs昨日、本周vs上周、近7天趋势等）
4. 可以分析不同维度（投手、国家、广告系列、广告组、素材）
5. 对于素材分析，可以识别爆款素材特征、推荐复用或淘汰
6. 给出可操作的优化建议
7. 如果需要更详细的数据，说明需要什么`

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
   * 获取所有广告投放数据 - 增强版，支持跨时间区域和更细粒度
   */
  private async getAllAdvertisingData(): Promise<any> {
    const today = dayjs().format('YYYY-MM-DD')
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const sevenDaysAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const fourteenDaysAgo = dayjs().subtract(14, 'day').format('YYYY-MM-DD')
    const thirtyDaysAgo = dayjs().subtract(30, 'day').format('YYYY-MM-DD')

    // 获取所有账户
    const accounts = await Account.find().lean()
    const tokens = await FbToken.find({ status: 'active' }).lean()
    const token = tokens[0]?.token

    // 🔥 使用和 Dashboard 相同的数据源，确保数据准确
    logger.info('[AgentService] Fetching core metrics from Dashboard API...')
    let coreMetrics: any = null
    try {
      coreMetrics = await getCoreMetrics(sevenDaysAgo, today)
    } catch (e: any) {
      logger.error('[AgentService] Failed to get core metrics:', e.message)
    }

    // 1. 今日实时数据 - 使用 Dashboard 的准确数据
    let todaySummary: any = {
      spend: '$' + (coreMetrics?.today?.spend || 0).toFixed(2),
      impressions: coreMetrics?.today?.impressions || 0,
      clicks: coreMetrics?.today?.clicks || 0,
      purchase_value: '$' + (coreMetrics?.today?.purchase_value || 0).toFixed(2),
      roas: coreMetrics?.today?.spend > 0 
        ? ((coreMetrics?.today?.purchase_value || 0) / coreMetrics?.today?.spend).toFixed(2) 
        : '0',
      installs: coreMetrics?.today?.installs || 0,
    }
    
    // 计算派生指标
    const todaySpend = coreMetrics?.today?.spend || 0
    const todayImpressions = coreMetrics?.today?.impressions || 0
    const todayClicks = coreMetrics?.today?.clicks || 0
    if (todayImpressions > 0) {
      todaySummary.ctr = (todayClicks / todayImpressions * 100).toFixed(2) + '%'
      todaySummary.cpm = '$' + (todaySpend / todayImpressions * 1000).toFixed(2)
    }
    if (todayClicks > 0) {
      todaySummary.cpc = '$' + (todaySpend / todayClicks).toFixed(2)
    }

    // 2. 昨日数据 - 使用 Dashboard 的准确数据
    const yesterdaySummary = {
      spend: '$' + (coreMetrics?.yesterday?.spend || 0).toFixed(2),
      impressions: coreMetrics?.yesterday?.impressions || 0,
      clicks: coreMetrics?.yesterday?.clicks || 0,
      purchase_value: '$' + (coreMetrics?.yesterday?.purchase_value || 0).toFixed(2),
      roas: coreMetrics?.yesterday?.spend > 0 
        ? ((coreMetrics?.yesterday?.purchase_value || 0) / coreMetrics?.yesterday?.spend).toFixed(2) 
        : '0',
    }

    // 3. 7日汇总数据
    const sevenDaysSummary = {
      totalSpend: '$' + (coreMetrics?.sevenDays?.spend || 0).toFixed(2),
      totalRevenue: '$' + (coreMetrics?.sevenDays?.purchase_value || 0).toFixed(2),
      avgRoas: coreMetrics?.sevenDays?.spend > 0 
        ? ((coreMetrics?.sevenDays?.purchase_value || 0) / coreMetrics?.sevenDays?.spend).toFixed(2) 
        : '0',
    }

    // 辅助函数：从 raw.action_values 中提取 purchase 值
    const extractPurchaseValue = (doc: any): number => {
      if (doc.purchase_value && doc.purchase_value > 0) return doc.purchase_value
      if (doc.raw?.action_values) {
        for (const av of doc.raw.action_values) {
          if (av.action_type === 'purchase' || av.action_type === 'omni_purchase') {
            return parseFloat(av.value) || 0
          }
        }
      }
      return 0
    }

    // 2. 最近30天趋势（更长时间范围）- 移除 campaignId 限制，使用所有数据
    const last30DaysTrend = await MetricsDaily.aggregate([
      {
        $match: {
          date: { $gte: thirtyDaysAgo, $lte: today },
          spendUsd: { $gt: 0 } // 只要有消耗的数据
        }
      },
      {
        // 尝试从 raw.action_values 提取 purchase value
        $addFields: {
          extractedPurchaseValue: {
            $reduce: {
              input: { $ifNull: ['$raw.action_values', []] },
              initialValue: 0,
              in: {
                $cond: [
                  { $in: ['$$this.action_type', ['purchase', 'omni_purchase']] },
                  { $add: ['$$value', { $toDouble: { $ifNull: ['$$this.value', '0'] } }] },
                  '$$value'
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: '$date',
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $max: [{ $ifNull: ['$purchase_value', 0] }, '$extractedPurchaseValue'] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
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
          installs: 1,
          ctr: {
            $concat: [
              { $toString: { $round: [{ $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0] }, 2] } },
              '%'
            ]
          }
        }
      }
    ])

    // 2.1 最近7天趋势（用于对比）
    const last7DaysTrend = last30DaysTrend.filter((d: any) => d.date >= sevenDaysAgo)

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

    // 4. 分国家数据 - 从 Facebook API 获取
    const countryDataMap: Record<string, { country: string, spend: number, revenue: number, impressions: number, clicks: number }> = {}
    
    if (token) {
      for (const account of accounts.slice(0, 5)) { // 限制账户数量
        try {
          const insights = await fetchInsights(
            `act_${account.accountId}`,
            'campaign',
            undefined,
            token,
            ['country'],
            { since: today, until: today }
          )
          
          for (const insight of insights) {
            const country = insight.country
            if (!country) continue
            
            if (!countryDataMap[country]) {
              countryDataMap[country] = { country, spend: 0, revenue: 0, impressions: 0, clicks: 0 }
            }
            
            countryDataMap[country].spend += parseFloat(insight.spend || '0')
            countryDataMap[country].impressions += parseInt(insight.impressions || '0', 10)
            countryDataMap[country].clicks += parseInt(insight.clicks || '0', 10)
            
            // 提取 purchase value
            if (insight.action_values) {
              for (const av of insight.action_values) {
                if (av.action_type === 'purchase' || av.action_type === 'omni_purchase') {
                  countryDataMap[country].revenue += parseFloat(av.value || '0')
                }
              }
            }
          }
        } catch (e) {
          // 继续
        }
      }
    }
    
    const countryData = Object.values(countryDataMap)
      .map(c => ({
        country: c.country,
        spend: Math.round(c.spend * 100) / 100,
        revenue: Math.round(c.revenue * 100) / 100,
        roas: c.spend > 0 ? Math.round((c.revenue / c.spend) * 100) / 100 : 0,
        impressions: c.impressions,
        clicks: c.clicks,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 15)

    // 5. 表现最佳的广告系列 - 从 raw.action_values 提取 purchase_value
    const topCampaigns = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          date: today
        }
      },
      {
        // 从 raw.action_values 提取 purchase value
        $addFields: {
          extractedPurchaseValue: {
            $reduce: {
              input: { $ifNull: ['$raw.action_values', []] },
              initialValue: 0,
              in: {
                $cond: [
                  { $in: ['$$this.action_type', ['purchase', 'omni_purchase']] },
                  { $add: ['$$value', { $toDouble: { $ifNull: ['$$this.value', '0'] } }] },
                  '$$value'
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: '$campaignId',
          name: { $first: '$campaignName' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $max: [{ $ifNull: ['$purchase_value', 0] }, '$extractedPurchaseValue'] } },
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

    // 6. 亏损广告系列 - 从 raw.action_values 提取 purchase_value
    const losingCampaigns = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          date: today
        }
      },
      {
        $addFields: {
          extractedPurchaseValue: {
            $reduce: {
              input: { $ifNull: ['$raw.action_values', []] },
              initialValue: 0,
              in: {
                $cond: [
                  { $in: ['$$this.action_type', ['purchase', 'omni_purchase']] },
                  { $add: ['$$value', { $toDouble: { $ifNull: ['$$this.value', '0'] } }] },
                  '$$value'
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: '$campaignId',
          name: { $first: '$campaignName' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $max: [{ $ifNull: ['$purchase_value', 0] }, '$extractedPurchaseValue'] } },
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

    // 8. 所有广告系列详细数据（今日）- 从 raw.action_values 提取 purchase_value
    const allCampaignsToday = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          date: today
        }
      },
      {
        $addFields: {
          extractedPurchaseValue: {
            $reduce: {
              input: { $ifNull: ['$raw.action_values', []] },
              initialValue: 0,
              in: {
                $cond: [
                  { $in: ['$$this.action_type', ['purchase', 'omni_purchase']] },
                  { $add: ['$$value', { $toDouble: { $ifNull: ['$$this.value', '0'] } }] },
                  '$$value'
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: '$campaignId',
          name: { $first: '$campaignName' },
          accountId: { $first: '$accountId' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $max: [{ $ifNull: ['$purchase_value', 0] }, '$extractedPurchaseValue'] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
        }
      },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          ctr: { $cond: [{ $gt: ['$impressions', 0] }, { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0] },
          cpc: { $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0] },
          cpi: { $cond: [{ $gt: ['$installs', 0] }, { $divide: ['$spend', '$installs'] }, 0] },
          optimizer: { $arrayElemAt: [{ $split: ['$name', '_'] }, 0] }
        }
      },
      { $match: { spend: { $gt: 1 } } },
      { $sort: { spend: -1 } },
      { $limit: 50 },
      {
        $project: {
          campaignId: '$_id',
          name: 1,
          optimizer: 1,
          accountId: 1,
          spend: { $round: ['$spend', 2] },
          revenue: { $round: ['$revenue', 2] },
          roas: { $round: ['$roas', 2] },
          impressions: 1,
          clicks: 1,
          installs: 1,
          ctr: { $concat: [{ $toString: { $round: ['$ctr', 2] } }, '%'] },
          cpc: { $round: ['$cpc', 2] },
          cpi: { $round: ['$cpi', 2] },
          status: { $cond: [{ $gte: ['$roas', 1] }, '盈利', { $cond: [{ $gte: ['$roas', 0.5] }, '微亏', '亏损'] }] }
        }
      }
    ])

    // 9. 最近7天广告系列表现对比
    const campaignTrends = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          date: { $gte: sevenDaysAgo, $lte: today }
        }
      },
      {
        $group: {
          _id: { campaignId: '$campaignId', date: '$date' },
          name: { $first: '$campaignName' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
        }
      },
      {
        $group: {
          _id: '$_id.campaignId',
          name: { $first: '$name' },
          dailyData: {
            $push: {
              date: '$_id.date',
              spend: { $round: ['$spend', 2] },
              revenue: { $round: ['$revenue', 2] },
              roas: { $cond: [{ $gt: ['$spend', 0] }, { $round: [{ $divide: ['$revenue', '$spend'] }, 2] }, 0] }
            }
          },
          totalSpend: { $sum: '$spend' },
          totalRevenue: { $sum: '$revenue' },
        }
      },
      { $match: { totalSpend: { $gt: 50 } } },
      { $sort: { totalSpend: -1 } },
      { $limit: 20 },
      {
        $project: {
          name: 1,
          optimizer: { $arrayElemAt: [{ $split: ['$name', '_'] }, 0] },
          totalSpend: { $round: ['$totalSpend', 2] },
          totalRevenue: { $round: ['$totalRevenue', 2] },
          avgRoas: { $round: [{ $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] }, 2] },
          dailyData: 1,
        }
      }
    ])

    // 10. 分国家历史趋势（最近7天每个国家的数据）
    const countryHistoricalTrend = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          country: { $exists: true, $ne: null },
          date: { $gte: sevenDaysAgo, $lte: today }
        }
      },
      {
        $group: {
          _id: { country: '$country', date: '$date' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
        }
      },
      {
        $group: {
          _id: '$_id.country',
          dailyData: {
            $push: {
              date: '$_id.date',
              spend: { $round: ['$spend', 2] },
              revenue: { $round: ['$revenue', 2] },
              roas: { $cond: [{ $gt: ['$spend', 0] }, { $round: [{ $divide: ['$revenue', '$spend'] }, 2] }, 0] },
              installs: '$installs'
            }
          },
          totalSpend: { $sum: '$spend' },
          totalRevenue: { $sum: '$revenue' },
        }
      },
      { $match: { totalSpend: { $gt: 10 } } },
      { $sort: { totalSpend: -1 } },
      { $limit: 15 },
      {
        $project: {
          country: '$_id',
          totalSpend: { $round: ['$totalSpend', 2] },
          totalRevenue: { $round: ['$totalRevenue', 2] },
          avgRoas: { $round: [{ $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] }, 2] },
          dailyData: 1
        }
      }
    ])

    // 11. 分投手历史趋势（最近7天每个投手的数据）
    const optimizerHistoricalTrend = await MetricsDaily.aggregate([
      {
        $match: {
          campaignId: { $exists: true, $ne: null },
          campaignName: { $exists: true, $ne: null },
          date: { $gte: sevenDaysAgo, $lte: today }
        }
      },
      {
        $addFields: {
          optimizer: { $arrayElemAt: [{ $split: ['$campaignName', '_'] }, 0] }
        }
      },
      {
        $group: {
          _id: { optimizer: '$optimizer', date: '$date' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
          campaignCount: { $addToSet: '$campaignId' }
        }
      },
      {
        $group: {
          _id: '$_id.optimizer',
          dailyData: {
            $push: {
              date: '$_id.date',
              spend: { $round: ['$spend', 2] },
              revenue: { $round: ['$revenue', 2] },
              roas: { $cond: [{ $gt: ['$spend', 0] }, { $round: [{ $divide: ['$revenue', '$spend'] }, 2] }, 0] },
              installs: '$installs',
              campaigns: { $size: '$campaignCount' }
            }
          },
          totalSpend: { $sum: '$spend' },
          totalRevenue: { $sum: '$revenue' },
        }
      },
      { $match: { totalSpend: { $gt: 10 } } },
      { $sort: { totalSpend: -1 } },
      { $limit: 10 },
      {
        $project: {
          optimizer: '$_id',
          totalSpend: { $round: ['$totalSpend', 2] },
          totalRevenue: { $round: ['$totalRevenue', 2] },
          avgRoas: { $round: [{ $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] }, 2] },
          dailyData: 1
        }
      }
    ])

    // 12. 本周 vs 上周对比 - 使用所有数据，提取 purchase_value
    const thisWeekStart = dayjs().startOf('week').format('YYYY-MM-DD')
    const thisWeekEnd = today
    const lastWeekStart = dayjs().subtract(1, 'week').startOf('week').format('YYYY-MM-DD')
    const lastWeekEnd = dayjs().subtract(1, 'week').endOf('week').format('YYYY-MM-DD')

    const weeklyComparison = await Promise.all([
      // 本周数据
      MetricsDaily.aggregate([
        {
          $match: {
            date: { $gte: thisWeekStart, $lte: thisWeekEnd },
            spendUsd: { $gt: 0 }
          }
        },
        {
          $addFields: {
            extractedPurchaseValue: {
              $reduce: {
                input: { $ifNull: ['$raw.action_values', []] },
                initialValue: 0,
                in: {
                  $cond: [
                    { $in: ['$$this.action_type', ['purchase', 'omni_purchase']] },
                    { $add: ['$$value', { $toDouble: { $ifNull: ['$$this.value', '0'] } }] },
                    '$$value'
                  ]
                }
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            spend: { $sum: '$spendUsd' },
            revenue: { $sum: { $max: [{ $ifNull: ['$purchase_value', 0] }, '$extractedPurchaseValue'] } },
            impressions: { $sum: '$impressions' },
            clicks: { $sum: '$clicks' },
            installs: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
          }
        }
      ]),
      // 上周数据
      MetricsDaily.aggregate([
        {
          $match: {
            date: { $gte: lastWeekStart, $lte: lastWeekEnd },
            spendUsd: { $gt: 0 }
          }
        },
        {
          $addFields: {
            extractedPurchaseValue: {
              $reduce: {
                input: { $ifNull: ['$raw.action_values', []] },
                initialValue: 0,
                in: {
                  $cond: [
                    { $in: ['$$this.action_type', ['purchase', 'omni_purchase']] },
                    { $add: ['$$value', { $toDouble: { $ifNull: ['$$this.value', '0'] } }] },
                    '$$value'
                  ]
                }
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            spend: { $sum: '$spendUsd' },
            revenue: { $sum: { $max: [{ $ifNull: ['$purchase_value', 0] }, '$extractedPurchaseValue'] } },
            impressions: { $sum: '$impressions' },
            clicks: { $sum: '$clicks' },
            installs: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
          }
        }
      ])
    ])

    const thisWeekData = weeklyComparison[0][0] || { spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0 }
    const lastWeekData = weeklyComparison[1][0] || { spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0 }

    const periodComparison = {
      thisWeek: {
        period: `${thisWeekStart} ~ ${thisWeekEnd}`,
        spend: Math.round(thisWeekData.spend * 100) / 100,
        revenue: Math.round(thisWeekData.revenue * 100) / 100,
        roas: thisWeekData.spend > 0 ? Math.round((thisWeekData.revenue / thisWeekData.spend) * 100) / 100 : 0,
        impressions: thisWeekData.impressions,
        clicks: thisWeekData.clicks,
        installs: thisWeekData.installs,
      },
      lastWeek: {
        period: `${lastWeekStart} ~ ${lastWeekEnd}`,
        spend: Math.round(lastWeekData.spend * 100) / 100,
        revenue: Math.round(lastWeekData.revenue * 100) / 100,
        roas: lastWeekData.spend > 0 ? Math.round((lastWeekData.revenue / lastWeekData.spend) * 100) / 100 : 0,
        impressions: lastWeekData.impressions,
        clicks: lastWeekData.clicks,
        installs: lastWeekData.installs,
      },
      changes: {
        spendChange: lastWeekData.spend > 0 ? Math.round(((thisWeekData.spend - lastWeekData.spend) / lastWeekData.spend) * 10000) / 100 + '%' : 'N/A',
        revenueChange: lastWeekData.revenue > 0 ? Math.round(((thisWeekData.revenue - lastWeekData.revenue) / lastWeekData.revenue) * 10000) / 100 + '%' : 'N/A',
        roasChange: lastWeekData.spend > 0 && thisWeekData.spend > 0 ? 
          Math.round(((thisWeekData.revenue / thisWeekData.spend) - (lastWeekData.revenue / lastWeekData.spend)) * 100) / 100 : 0,
      }
    }

    // 13. 今日 vs 昨日对比 - 现在使用 getCoreMetrics 的数据（更准确）
    // 已在函数开头通过 yesterdaySummary 变量获取

    // 14. AdSet 级别数据（今日 Top 20）
    const adsetDataToday = await MetricsDaily.aggregate([
      {
        $match: {
          adsetId: { $exists: true, $ne: null },
          date: today
        }
      },
      {
        $group: {
          _id: '$adsetId',
          campaignId: { $first: '$campaignId' },
          campaignName: { $first: '$campaignName' },
          spend: { $sum: '$spendUsd' },
          revenue: { $sum: { $ifNull: ['$purchase_value', 0] } },
          impressions: { $sum: '$impressions' },
          clicks: { $sum: '$clicks' },
          installs: { $sum: { $ifNull: ['$mobile_app_install_count', 0] } },
        }
      },
      {
        $addFields: {
          roas: { $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$revenue', '$spend'] }, 0] },
          cpi: { $cond: [{ $gt: ['$installs', 0] }, { $divide: ['$spend', '$installs'] }, 0] },
          optimizer: { $arrayElemAt: [{ $split: ['$campaignName', '_'] }, 0] }
        }
      },
      { $match: { spend: { $gt: 1 } } },
      { $sort: { spend: -1 } },
      { $limit: 20 },
      {
        $project: {
          adsetId: '$_id',
          campaignId: 1,
          campaignName: 1,
          optimizer: 1,
          spend: { $round: ['$spend', 2] },
          revenue: { $round: ['$revenue', 2] },
          roas: { $round: ['$roas', 2] },
          impressions: 1,
          clicks: 1,
          installs: 1,
          cpi: { $round: ['$cpi', 2] },
        }
      }
    ])

    return {
      // 时间信息
      dataTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      dateRange: {
        today,
        yesterday,
        last7Days: { from: sevenDaysAgo, to: today },
        last30Days: { from: thirtyDaysAgo, to: today },
      },
      
      // 今日实时概览（来自 Dashboard API，数据准确）
      todaySummary,
      
      // 昨日数据（来自 Dashboard API，数据准确）
      yesterdaySummary,
      
      // 7日汇总（来自 Dashboard API）
      sevenDaysSummary,
      
      // 时间趋势
      last7DaysTrend,
      last30DaysTrend,
      
      // 周期对比
      periodComparison,
      
      // 分维度数据（今日）
      optimizerData: campaignsWithMetrics,
      countryData,
      
      // 分维度历史趋势
      countryHistoricalTrend,
      optimizerHistoricalTrend,
      
      // 广告系列数据
      topCampaigns,
      losingCampaigns,
      allCampaignsToday,
      campaignTrends,
      totalCampaigns: allCampaignsToday.length,
      
      // AdSet 级别数据
      adsetDataToday,
      
      // 账户数据
      accountsSummary,
      
      // 素材级别数据
      materialMetrics: await this.getMaterialMetricsForAI(sevenDaysAgo, today),
    }
  }

  /**
   * 获取素材级别数据供 AI 使用
   */
  private async getMaterialMetricsForAI(startDate: string, endDate: string): Promise<any> {
    try {
      // 获取最近7天表现最好的素材
      const topMaterials = await MaterialMetrics.aggregate([
        {
          $match: {
            date: { $gte: startDate, $lte: endDate },
            spend: { $gt: 5 }
          }
        },
        {
          $group: {
            _id: { $ifNull: ['$imageHash', '$videoId'] },
            materialType: { $first: '$materialType' },
            materialName: { $first: '$materialName' },
            thumbnailUrl: { $first: '$thumbnailUrl' },
            totalSpend: { $sum: '$spend' },
            totalRevenue: { $sum: '$purchaseValue' },
            totalImpressions: { $sum: '$impressions' },
            totalClicks: { $sum: '$clicks' },
            totalInstalls: { $sum: '$installs' },
            avgQualityScore: { $avg: '$qualityScore' },
            daysActive: { $sum: 1 },
            allOptimizers: { $push: '$optimizers' },
            allCampaigns: { $push: '$campaignIds' },
          }
        },
        {
          $addFields: {
            roas: { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] },
            ctr: { $cond: [{ $gt: ['$totalImpressions', 0] }, { $multiply: [{ $divide: ['$totalClicks', '$totalImpressions'] }, 100] }, 0] },
          }
        },
        { $sort: { roas: -1 } },
        { $limit: 15 },
        {
          $project: {
            materialKey: '$_id',
            materialType: 1,
            materialName: 1,
            spend: { $round: ['$totalSpend', 2] },
            revenue: { $round: ['$totalRevenue', 2] },
            roas: { $round: ['$roas', 2] },
            ctr: { $round: ['$ctr', 2] },
            impressions: '$totalImpressions',
            clicks: '$totalClicks',
            installs: '$totalInstalls',
            qualityScore: { $round: ['$avgQualityScore', 0] },
            daysActive: 1,
            optimizers: { 
              $reduce: { 
                input: '$allOptimizers', 
                initialValue: [], 
                in: { $setUnion: ['$$value', '$$this'] } 
              } 
            },
          }
        }
      ])

      // 获取表现最差的素材（高消耗低ROAS）
      const losingMaterials = await MaterialMetrics.aggregate([
        {
          $match: {
            date: { $gte: startDate, $lte: endDate },
            spend: { $gt: 20 }
          }
        },
        {
          $group: {
            _id: { $ifNull: ['$imageHash', '$videoId'] },
            materialType: { $first: '$materialType' },
            materialName: { $first: '$materialName' },
            totalSpend: { $sum: '$spend' },
            totalRevenue: { $sum: '$purchaseValue' },
            allOptimizers: { $push: '$optimizers' },
          }
        },
        {
          $addFields: {
            roas: { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] },
            loss: { $subtract: ['$totalSpend', '$totalRevenue'] }
          }
        },
        { $match: { roas: { $lt: 0.5 } } },
        { $sort: { loss: -1 } },
        { $limit: 10 },
        {
          $project: {
            materialKey: '$_id',
            materialType: 1,
            materialName: 1,
            spend: { $round: ['$totalSpend', 2] },
            revenue: { $round: ['$totalRevenue', 2] },
            roas: { $round: ['$roas', 2] },
            loss: { $round: ['$loss', 2] },
            optimizers: { 
              $reduce: { 
                input: '$allOptimizers', 
                initialValue: [], 
                in: { $setUnion: ['$$value', '$$this'] } 
              } 
            },
          }
        }
      ])

      // 素材类型统计
      const materialTypeStats = await MaterialMetrics.aggregate([
        {
          $match: {
            date: { $gte: startDate, $lte: endDate },
            spend: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: '$materialType',
            totalSpend: { $sum: '$spend' },
            totalRevenue: { $sum: '$purchaseValue' },
            uniqueMaterials: { $addToSet: { $ifNull: ['$imageHash', '$videoId'] } },
          }
        },
        {
          $project: {
            type: '$_id',
            spend: { $round: ['$totalSpend', 2] },
            revenue: { $round: ['$totalRevenue', 2] },
            roas: { 
              $round: [
                { $cond: [{ $gt: ['$totalSpend', 0] }, { $divide: ['$totalRevenue', '$totalSpend'] }, 0] },
                2
              ]
            },
            count: { $size: '$uniqueMaterials' }
          }
        }
      ])

      return {
        topMaterials,
        losingMaterials,
        materialTypeStats,
        totalMaterialsTracked: topMaterials.length + losingMaterials.length,
      }
    } catch (error) {
      logger.error('[AgentService] Failed to get material metrics:', error)
      return {
        topMaterials: [],
        losingMaterials: [],
        materialTypeStats: [],
        totalMaterialsTracked: 0,
        error: '素材数据暂不可用'
      }
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
   * 获取广告系列/广告组的指标序列 (用于趋势分析)
   */
  private async getMetricSequence(
    entityId: string,
    entityType: 'campaign' | 'adset' | 'ad',
    days: number = 7
  ): Promise<MetricSequence> {
    const startDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD')
    
    const query: any = {
      entityId,
      level: entityType,
      date: { $gte: startDate }
    }

    const docs = await MetricsDaily.find(query).sort({ date: 1 }).lean()
    
    const sequence: MetricSequence = {
      cpm: [],
      ctr: [],
      cpc: [],
      cpa: [],
      roas: [],
      hookRate: [], // 🆕
      atcRate: [],  // 🆕
    }

    for (const d of docs) {
      sequence.cpm.push(d.cpm || 0)
      sequence.ctr.push(d.ctr || 0)
      sequence.cpc.push(d.cpc || 0)
      // CPA = spend / installs (or conversions)
      const cpa = d.installs > 0 ? d.spendUsd / d.installs : 0
      sequence.cpa.push(cpa)
      // ROAS = revenue / spend
      const roas = d.spendUsd > 0 ? (d.purchase_value || 0) / d.spendUsd : 0
      sequence.roas.push(roas)

      // Hook Rate = video_3sec_views / impressions
      const actions = d.actions || []
      const video3sAction = Array.isArray(actions) ? actions.find((a: any) => a.action_type === 'video_view' || a.action_type === 'video_3sec_views') : null
      const video3s = video3sAction ? parseFloat(video3sAction.value) : (d.raw?.video_3sec_views || 0)
      const hookRate = d.impressions > 0 ? video3s / d.impressions : 0
      sequence.hookRate.push(hookRate)

      // ATC Rate = add_to_cart / clicks
      const atcAction = Array.isArray(actions) ? actions.find((a: any) => a.action_type === 'add_to_cart') : null
      const atcCount = atcAction ? parseFloat(atcAction.value) : 0
      const atcRate = d.clicks > 0 ? atcCount / d.clicks : 0
      sequence.atcRate.push(atcRate)
    }

    return sequence
  }

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
    // 账户范围：优先 scope.adAccountIds，其次旧 accountIds，否则全量 active（并按 organizationId 过滤）
    const scopedAccountIds: string[] = agent.scope?.adAccountIds?.length
      ? agent.scope.adAccountIds
      : (agent.accountIds || [])

    const accountQuery: any = { status: 'active' }
    if (agent.organizationId) {
      accountQuery.organizationId = agent.organizationId
    }
    if (scopedAccountIds.length > 0) {
      accountQuery.accountId = { $in: scopedAccountIds }
    }

    const accounts = await Account.find(accountQuery)

    // ---------- 护栏：异常触发降级（auto -> suggest） ----------
    let effectiveMode: 'observe' | 'suggest' | 'auto' = agent.mode
    try {
      if (agent.alerts?.enabled && agent.mode === 'auto' && accounts.length > 0) {
        const today = dayjs().format('YYYY-MM-DD')
        const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
        const accountIds = accounts.map((a: any) => a.accountId)

        const [todayAgg, yesterdayAgg] = await Promise.all([
          MetricsDaily.aggregate([
            { $match: { date: today, accountId: { $in: accountIds } } },
            { $group: { _id: null, spend: { $sum: '$spendUsd' }, revenue: { $sum: { $ifNull: ['$purchase_value', 0] } } } },
          ]),
          MetricsDaily.aggregate([
            { $match: { date: yesterday, accountId: { $in: accountIds } } },
            { $group: { _id: null, spend: { $sum: '$spendUsd' }, revenue: { $sum: { $ifNull: ['$purchase_value', 0] } } } },
          ]),
        ])

        const todaySpend = Number(todayAgg?.[0]?.spend || 0)
        const yesterdaySpend = Number(yesterdayAgg?.[0]?.spend || 0)
        const spendChangePct = yesterdaySpend > 0 ? ((todaySpend - yesterdaySpend) / yesterdaySpend) * 100 : 0

        const spikeThreshold = Number(agent.alerts?.thresholds?.spendSpikePercent ?? 50)
        if (todaySpend > 0 && spendChangePct > spikeThreshold) {
          effectiveMode = 'suggest'
          logger.warn(
            `[AgentService] Degrade to suggest due to spend spike: ${spendChangePct.toFixed(1)}% > ${spikeThreshold}% (today=$${todaySpend.toFixed(
              2,
            )}, yesterday=$${yesterdaySpend.toFixed(2)})`,
          )
        }
      }
    } catch (e: any) {
      // 降级判定失败不阻塞主流程
      logger.warn('[AgentService] Degrade check failed:', e?.message || e)
    }

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

    // 根据模式处理操作（observe/suggest/auto）
    if (effectiveMode === 'observe') {
      // 仅记录，不执行
      for (const op of operations) {
        op.status = 'pending'
        await new AgentOperation(op).save()
      }
    } else if (effectiveMode === 'suggest') {
      // 记录并通知
      for (const op of operations) {
        op.status = 'pending'
        const saved = await new AgentOperation(op).save()
        // TODO: 发送通知
      }
    } else if (effectiveMode === 'auto') {
      // 自动执行
      for (const op of operations) {
        // RBAC：动作级别开关
        if (!this.isOperationAllowedByPermissions(op, agent)) {
          op.status = 'rejected'
          op.error = 'Operation rejected by agent permissions (RBAC)'
          await new AgentOperation(op).save()
          continue
        }

        // 护栏：预算/幅度/上限（超出则拒绝并记录）
        const guardrail = this.checkGuardrails(op, agent)
        if (!guardrail.ok) {
          op.status = 'rejected'
          op.error = guardrail.reason
          await new AgentOperation(op).save()
          continue
        }

        if (agent.aiConfig.requireApproval && this.needsApproval(op, agent)) {
          op.status = 'pending'
          await new AgentOperation(op).save()
        } else {
          const saved = await new AgentOperation({ ...op, status: 'approved' }).save()
          await this.executeOperation(saved._id.toString(), agent)
        }
      }
    }

    return {
      success: true,
      operationsCount: operations.length,
      effectiveMode,
      operations: operations.map(o => ({ action: o.action, entityId: o.entityId, reason: o.reason })),
    }
  }

  /**
   * Planner/Executor 形态：只生成计划与执行 jobs，不在当前进程直接执行 Graph 写操作
   * - Planner：复用 runAgent 的规则生成 operations
   * - Executor：为每个 operation 创建 AutomationJob（由 Worker 并行执行）
   */
  async runAgentAsJobs(agentId: string): Promise<any> {
    const agent: any = await AgentConfig.findById(agentId)
    if (!agent || agent.status !== 'active') {
      return { success: false, message: 'Agent not active' }
    }

    const operations: any[] = []

    // 账户范围：优先 scope.adAccountIds，其次旧 accountIds，否则全量 active（并按 organizationId 过滤）
    const scopedAccountIds: string[] = agent.scope?.adAccountIds?.length
      ? agent.scope.adAccountIds
      : (agent.accountIds || [])

    const accountQuery: any = { status: 'active' }
    if (agent.organizationId) {
      accountQuery.organizationId = agent.organizationId
    }
    if (scopedAccountIds.length > 0) {
      accountQuery.accountId = { $in: scopedAccountIds }
    }

    const accounts = await Account.find(accountQuery)

    for (const account of accounts) {
      const campaignPerformance = await this.getCampaignPerformance(account.accountId, 7)
      for (const campaign of campaignPerformance) {
        // --- 开始生命周期加权评分逻辑 (LCWTS) ---
        const sequence = await this.getMetricSequence(campaign._id, 'campaign', 7)
        const currentMetrics: MetricData = {
          cpm: campaign.dailyData[campaign.dailyData.length - 1]?.spend > 0 ? (campaign.dailyData[campaign.dailyData.length - 1].spend / campaign.dailyData[campaign.dailyData.length - 1].impressions) * 1000 : 0,
          ctr: campaign.dailyData[campaign.dailyData.length - 1]?.impressions > 0 ? campaign.dailyData[campaign.dailyData.length - 1].clicks / campaign.dailyData[campaign.dailyData.length - 1].impressions : 0,
          cpc: campaign.dailyData[campaign.dailyData.length - 1]?.clicks > 0 ? campaign.dailyData[campaign.dailyData.length - 1].spend / campaign.dailyData[campaign.dailyData.length - 1].clicks : 0,
          cpa: campaign.totalRevenue > 0 ? campaign.totalSpend / campaign.totalRevenue : 0, // 简化处理，实际应取具体转化
          roas: campaign.avgRoas,
          spend: campaign.totalSpend, // 累计消耗用于识别阶段
          hookRate: sequence.hookRate[sequence.hookRate.length - 1] || 0, // 🆕
          atcRate: sequence.atcRate[sequence.atcRate.length - 1] || 0,   // 🆕
        }

        // 获取详细评分结果
        const scoreResult = await scoringService.evaluate(currentMetrics, sequence, agent)
        const { finalScore, stage } = scoreResult

        // 根据配置的阈值决定动作
        let action: 'pause' | 'budget_increase' | 'budget_decrease' | null = null
        let reason = `[Stage: ${stage}] Score: ${finalScore.toFixed(1)}. `
        let changePercent = 0
        
        const thresholds = agent.actionThresholds || {
          aggressiveScale: { minScore: 85, changePercent: 30 },
          moderateScale: { minScore: 70, changePercent: 15 },
          stopLoss: { maxScore: 30, changePercent: -20 },
          kill: { maxScore: 15 }
        }

        if (finalScore >= thresholds.aggressiveScale.minScore) {
          action = 'budget_increase'
          changePercent = thresholds.aggressiveScale.changePercent
          reason += `High momentum & performance. Aggressive scale.`
        } else if (finalScore >= thresholds.moderateScale.minScore) {
          action = 'budget_increase'
          changePercent = thresholds.moderateScale.changePercent
          reason += `Good trend. Moderate scale.`
        } else if (finalScore < thresholds.kill.maxScore) {
          action = 'pause'
          reason += `Critical underperformance. Entity killed.`
        } else if (finalScore < thresholds.stopLoss.maxScore) {
          action = 'budget_decrease'
          changePercent = thresholds.stopLoss.changePercent
          reason += `Declining trend. Stop loss applied.`
        }

        if (action) {
          const op: any = {
            agentId: agent._id,
            accountId: account.accountId,
            entityType: 'campaign',
            entityId: campaign._id,
            entityName: campaign.campaignName,
            action,
            reason,
            dataSnapshot: campaign,
            scoreSnapshot: scoreResult, // 存入详细评分
          }

          if (action === 'budget_increase' || action === 'budget_decrease') {
            const campaignDoc = await Campaign.findOne({ campaignId: campaign._id })
            const currentBudget = parseFloat(campaignDoc?.daily_budget || '0') || 0
            const multiplier = 1 + (changePercent / 100)
            const nextBudget = currentBudget * multiplier
            
            op.beforeValue = { budget: currentBudget }
            op.afterValue = { budget: nextBudget }
            op.changePercent = changePercent
          } else if (action === 'pause') {
            op.beforeValue = { status: 'ACTIVE' }
            op.afterValue = { status: 'PAUSED' }
          }

          operations.push(op)
        }
      }
    }

    // 记录计划时间
    await AgentConfig.updateOne({ _id: agentId }, { $set: { 'runtime.lastPlanAt': new Date() } })

    // 保存操作 + 生成执行 jobs（仅当 agent.mode=auto 且无需审批且通过 RBAC/护栏）
    const jobs: any[] = []
    for (const op of operations) {
      // RBAC：动作级别开关
      if (!this.isOperationAllowedByPermissions(op, agent)) {
        await new AgentOperation({ ...op, status: 'rejected', error: 'Operation rejected by agent permissions (RBAC)' }).save()
        continue
      }

      const guardrail = this.checkGuardrails(op, agent)
      if (!guardrail.ok) {
        await new AgentOperation({ ...op, status: 'rejected', error: guardrail.reason }).save()
        continue
      }

      // --- 动量护栏检查 (Momentum Shield) ---
      const momentum = await momentumService.checkMomentum(op.entityId, op.action)
      if (!momentum.ok) {
        await new AgentOperation({ ...op, status: 'rejected', error: momentum.reason }).save()
        continue
      }

      // auto 模式下仍可要求审批
      if (agent.mode === 'auto' && agent.aiConfig?.requireApproval && this.needsApproval(op, agent)) {
        const saved = await new AgentOperation({ ...op, status: 'pending' }).save()
        // 发送飞书卡片
        if (agent.feishuConfig?.enabled) {
          const msgId = await feishuService.sendApprovalCard(saved, agent)
          if (msgId) {
            await AgentOperation.findByIdAndUpdate(saved._id, { feishuMessageId: msgId })
          }
        }
        continue
      }

      // observe/suggest：只记录并尝试发飞书
      if (agent.mode !== 'auto') {
        const saved = await new AgentOperation({ ...op, status: 'pending' }).save()
        if (agent.feishuConfig?.enabled) {
          const msgId = await feishuService.sendApprovalCard(saved, agent)
          if (msgId) {
            await AgentOperation.findByIdAndUpdate(saved._id, { feishuMessageId: msgId })
          }
        }
        continue
      }

      // auto 且不需要审批：写入 approved，并创建执行 job
      const saved = await new AgentOperation({ ...op, status: 'approved' }).save()
      const idempotencyKey = `op:${saved._id.toString()}`
      const job = await createAutomationJob({
        type: 'EXECUTE_AGENT_OPERATION',
        payload: { operationId: saved._id.toString(), agentId: agentId },
        agentId: agentId,
        organizationId: agent.organizationId,
        createdBy: agent.createdBy,
        idempotencyKey,
        priority: 5,
      })
      jobs.push(job)
    }

    if (agent.mode === 'auto') {
      await AgentConfig.updateOne({ _id: agentId }, { $set: { 'runtime.lastRunAt': new Date() } })
    }

    return {
      success: true,
      operationsCount: operations.length,
      jobsCreated: jobs.length,
      jobs: jobs.map((j) => ({ id: j._id, status: j.status, type: j.type })),
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
  async executeOperation(operationId: string, agent?: any): Promise<any> {
    const operation: any = await AgentOperation.findById(operationId)
    if (!operation) {
      return { success: false, error: 'Operation not found' }
    }

    const token = await this.resolveTokenForAccount(operation.accountId, agent)
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

  /**
   * 根据 agent scope/org 选择可访问该广告账户的 token
   */
  private async resolveTokenForAccount(accountId: string, agent?: any): Promise<any | null> {
    const tokenQuery: any = { status: 'active' }
    if (agent?.organizationId) {
      tokenQuery.organizationId = agent.organizationId
    }
    if (agent?.scope?.fbTokenIds?.length) {
      tokenQuery._id = { $in: agent.scope.fbTokenIds }
    }

    const tokens: any[] = await FbToken.find(tokenQuery).sort({ updatedAt: -1 }).lean()
    if (!tokens.length) return null

    // 逐个测试 token 是否有访问权限（带缓存）
    for (const t of tokens) {
      const cacheKey = `${t._id}:${accountId}`
      const cached = this.tokenAccessCache.get(cacheKey)
      if (cached === true) return t
      if (cached === false) continue

      try {
        const r = await facebookClient.get(`/act_${accountId}`, {
          access_token: t.token,
          fields: 'id',
        })
        if (r?.id) {
          this.tokenAccessCache.set(cacheKey, true)
          return t
        }
        this.tokenAccessCache.set(cacheKey, false)
      } catch {
        this.tokenAccessCache.set(cacheKey, false)
      }
    }

    return null
  }

  private isOperationAllowedByPermissions(operation: any, agent: any): boolean {
    const perms = agent?.permissions || {}
    if (operation.action === 'pause') return perms.canPause !== false
    if (operation.action === 'resume') return perms.canResume !== false
    if (operation.action === 'budget_increase' || operation.action === 'budget_decrease') return perms.canAdjustBudget !== false
    if (operation.action === 'bid_adjust') return perms.canAdjustBid === true
    if (operation.action === 'status_change') return perms.canToggleStatus !== false
    return true
  }

  private checkGuardrails(operation: any, agent: any): { ok: boolean; reason?: string } {
    // 预算上限护栏
    const limit = agent?.objectives?.dailyBudgetLimit
    if ((operation.action === 'budget_increase' || operation.action === 'budget_decrease') && limit != null) {
      const next = Number(operation.afterValue?.budget || 0)
      if (Number.isFinite(next) && next > Number(limit)) {
        return { ok: false, reason: `Guardrail: budget ${next} exceeds dailyBudgetLimit ${limit}` }
      }
    }

    // 最大调整幅度护栏（按比例）
    if (operation.action === 'budget_increase' || operation.action === 'budget_decrease') {
      const maxPct = agent?.rules?.budgetAdjust?.maxAdjustPercent
      if (maxPct != null && operation.changePercent != null) {
        const pct = Math.abs(Number(operation.changePercent)) / 100
        if (Number.isFinite(pct) && pct > Number(maxPct)) {
          return { ok: false, reason: `Guardrail: changePercent ${operation.changePercent}% exceeds maxAdjustPercent ${(Number(maxPct) * 100).toFixed(0)}%` }
        }
      }
    }

    return { ok: true }
  }

  // ==================== 素材 AI 智能评分 ====================

  /**
   * 🤖 AI 分析单个素材表现并给出评分和建议
   */
  async analyzeMaterialWithAI(materialId: string): Promise<any> {
    logger.info(`[AgentService] Analyzing material with AI: ${materialId}`)
    
    // 1. 获取素材表现数据
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    
    const rankings = await getMaterialRankings({
      dateRange: { start: startDate, end: endDate },
      limit: 100,
    })
    
    const material = rankings.find((m: any) => 
      m.materialId === materialId || m.localMaterialId === materialId
    )
    
    if (!material) {
      return {
        success: false,
        error: '未找到素材数据，可能该素材还没有投放数据',
      }
    }
    
    // 2. 获取素材详情
    const Material = require('../../models/Material').default
    const materialDoc = await Material.findById(materialId).lean()
    
    // 3. 如果没有 AI 模型，返回基础评分
    if (!this.model) {
      return {
        success: true,
        data: {
          materialId,
          materialName: material.materialName,
          materialType: material.materialType,
          metrics: {
            spend: material.spend,
            revenue: material.purchaseValue || 0,
            roas: material.roas,
            ctr: material.ctr,
            impressions: material.impressions,
            clicks: material.clicks,
            daysActive: material.daysActive,
          },
          scores: {
            overall: material.qualityScore,
            roas: material.roas >= 1 ? 80 : material.roas >= 0.5 ? 50 : 20,
            efficiency: material.ctr >= 1 ? 80 : material.ctr >= 0.5 ? 50 : 30,
          },
          analysis: `素材 ROAS ${material.roas?.toFixed(2) || 0}，消耗 $${material.spend?.toFixed(2) || 0}`,
          recommendation: material.roas >= 1.5 ? 'SCALE_UP' : material.roas < 0.5 ? 'PAUSE' : 'MAINTAIN',
          aiPowered: false,
        }
      }
    }
    
    // 4. 构建 AI 分析 Prompt
    const prompt = `作为一位资深 Facebook 广告投放优化师，请分析以下素材的表现数据：

## 素材信息
- 素材名称: ${material.materialName}
- 素材类型: ${material.materialType === 'video' ? '视频' : '图片'}
- 活跃天数: ${material.daysActive} 天
- 使用广告数: ${material.uniqueAdsCount || 0}

## 表现数据（最近7天）
- 总消耗: $${material.spend.toFixed(2)}
- 总收入: $${(material.purchaseValue || 0).toFixed(2)}
- ROAS: ${material.roas.toFixed(2)}
- 展示量: ${material.impressions?.toLocaleString() || 0}
- 点击量: ${material.clicks?.toLocaleString() || 0}
- CTR: ${material.ctr?.toFixed(2) || 0}%
- 安装数: ${material.installs || 0}
- CPI: $${material.cpi?.toFixed(2) || 0}

## 评判标准
- ROAS > 2: 优秀（可扩量）
- ROAS 1-2: 良好（可保持）
- ROAS 0.5-1: 一般（需优化）
- ROAS < 0.5: 较差（考虑暂停）

请给出详细分析，返回以下 JSON 格式（不要 Markdown 代码块）：
{
  "scores": {
    "overall": 0-100,
    "roas": 0-100,
    "efficiency": 0-100,
    "stability": 0-100
  },
  "analysis": "2-3句话的核心分析（中文）",
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["劣势1"],
  "recommendation": "SCALE_UP | MAINTAIN | OPTIMIZE | PAUSE",
  "actionItems": ["具体建议1", "具体建议2"],
  "predictedTrend": "UP | STABLE | DOWN"
}`

    try {
      logger.info(`[AgentService] Calling Gemini API, model exists: ${!!this.model}`)
      const result = await this.model.generateContent(prompt)
      const content = result.response.text()
      logger.info(`[AgentService] Gemini response length: ${content.length}`)
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      
      if (jsonMatch) {
        const aiResult = JSON.parse(jsonMatch[0])
        return {
          success: true,
          data: {
            materialId,
            materialName: material.materialName,
            materialType: material.materialType,
            metrics: {
              spend: material.spend,
              revenue: material.purchaseValue,
              roas: material.roas,
              ctr: material.ctr,
              impressions: material.impressions,
              clicks: material.clicks,
              daysActive: material.daysActive,
            },
            ...aiResult,
            aiPowered: true,
            analyzedAt: new Date().toISOString(),
          }
        }
      }
    } catch (error: any) {
      logger.error('[AgentService] AI analysis failed:', error.message || error)
      logger.error('[AgentService] Error stack:', error.stack)
      
      // AI 分析失败，返回带错误信息的基础结果
      return {
        success: true,
        data: {
          materialId,
          materialName: material.materialName,
          materialType: material.materialType,
          metrics: {
            spend: material.spend,
            revenue: material.purchaseValue || 0,
            roas: material.roas,
            ctr: material.ctr,
            impressions: material.impressions,
            clicks: material.clicks,
            daysActive: material.daysActive,
          },
          scores: { 
            overall: material.qualityScore,
            roas: material.roas >= 1 ? 80 : material.roas >= 0.5 ? 50 : 20,
          },
          analysis: `基础分析：ROAS ${material.roas?.toFixed(2) || 0}，消耗 $${material.spend?.toFixed(2) || 0}（AI 模型调用失败，使用规则分析）`,
          recommendation: material.roas >= 1.5 ? 'SCALE_UP' : material.roas < 0.5 ? 'PAUSE' : 'MAINTAIN',
          aiPowered: false,
          aiError: error.message || 'Unknown error',
        }
      }
    }
  }

  /**
   * 🤖 批量分析多个素材
   */
  async batchAnalyzeMaterials(materialIds: string[]): Promise<any[]> {
    const results = []
    for (const id of materialIds.slice(0, 10)) { // 限制最多10个
      const result = await this.analyzeMaterialWithAI(id)
      results.push(result)
    }
    return results
  }

  /**
   * 🤖 获取 AI 推荐的素材操作（自动化决策）
   */
  async getAIRecommendedActions(): Promise<any> {
    logger.info('[AgentService] Getting AI recommended actions')
    
    // 获取最近7天素材表现
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    
    const rankings = await getMaterialRankings({
      dateRange: { start: startDate, end: endDate },
      sortBy: 'spend',
      limit: 50,
    })
    
    // 分类素材
    const toScale = rankings.filter((m: any) => m.roas >= 2 && m.spend >= 50)
    const toPause = rankings.filter((m: any) => m.roas < 0.3 && m.spend >= 30)
    const toWatch = rankings.filter((m: any) => m.roas >= 0.5 && m.roas < 1 && m.spend >= 20)
    
    if (!this.model) {
      return {
        success: true,
        data: {
          toScale: toScale.map((m: any) => ({
            materialId: m.materialId,
            materialName: m.materialName,
            roas: m.roas,
            spend: m.spend,
            reason: `ROAS ${m.roas.toFixed(2)} 表现优秀`,
          })),
          toPause: toPause.map((m: any) => ({
            materialId: m.materialId,
            materialName: m.materialName,
            roas: m.roas,
            spend: m.spend,
            reason: `ROAS ${m.roas.toFixed(2)} 持续亏损`,
          })),
          toWatch: toWatch.map((m: any) => ({
            materialId: m.materialId,
            materialName: m.materialName,
            roas: m.roas,
            spend: m.spend,
          })),
          aiPowered: false,
        }
      }
    }
    
    // 使用 AI 生成更智能的建议
    const prompt = `作为广告优化师，分析以下素材数据，给出操作建议：

## 高效素材（ROAS > 2）
${toScale.map((m: any) => `- ${m.materialName}: ROAS ${m.roas.toFixed(2)}, 消耗 $${m.spend.toFixed(2)}`).join('\n') || '无'}

## 低效素材（ROAS < 0.3）
${toPause.map((m: any) => `- ${m.materialName}: ROAS ${m.roas.toFixed(2)}, 消耗 $${m.spend.toFixed(2)}`).join('\n') || '无'}

## 观察素材（0.5 < ROAS < 1）
${toWatch.map((m: any) => `- ${m.materialName}: ROAS ${m.roas.toFixed(2)}, 消耗 $${m.spend.toFixed(2)}`).join('\n') || '无'}

请返回 JSON（不要代码块）：
{
  "summary": "一句话总结当前素材表现",
  "urgentActions": ["最紧急需要做的1-2件事"],
  "scaleRecommendations": ["扩量建议"],
  "pauseRecommendations": ["暂停建议"],
  "optimizationTips": ["优化小贴士"]
}`

    try {
      const result = await this.model.generateContent(prompt)
      const content = result.response.text()
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      
      if (jsonMatch) {
        const aiResult = JSON.parse(jsonMatch[0])
        return {
          success: true,
          data: {
            ...aiResult,
            toScale,
            toPause,
            toWatch,
            aiPowered: true,
            analyzedAt: new Date().toISOString(),
          }
        }
      }
    } catch (error: any) {
      logger.error('[AgentService] AI recommendations failed:', error.message)
    }
    
    return {
      success: true,
      data: { toScale, toPause, toWatch, aiPowered: false }
    }
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

    // 如果是通过非飞书渠道审批的，尝试同步更新飞书卡片状态
    if (operation.feishuMessageId && !userId.startsWith('feishu:')) {
      const agent = await AgentConfig.findById(operation.agentId)
      if (agent) {
        feishuService.updateApprovalCard(operation.feishuMessageId, 'approved', userId, agent).catch(() => {})
      }
    }
    
    // 执行操作
    return this.executeOperation(operationId, await AgentConfig.findById(operation.agentId))
  }

  async rejectOperation(operationId: string, userId: string, reason?: string): Promise<any> {
    const operation: any = await AgentOperation.findById(operationId)
    if (operation?.feishuMessageId && !userId.startsWith('feishu:')) {
      const agent = await AgentConfig.findById(operation.agentId)
      if (agent) {
        feishuService.updateApprovalCard(operation.feishuMessageId, 'rejected', userId, agent).catch(() => {})
      }
    }

    return AgentOperation.findByIdAndUpdate(operationId, {
      status: 'rejected',
      executedBy: userId,
      error: reason || 'Rejected by user',
    }, { new: true })
  }
}

export const agentService = new AgentService()
