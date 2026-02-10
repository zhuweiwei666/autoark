/**
 * 读工具 - Agent 自由调用，不需要审批
 */
import { ToolDef, S } from '../tools'
import { AdAccount } from '../../data/account.model'
import { Metrics } from '../../data/metrics.model'
import { fetchCampaigns, fetchAdSets, fetchInsights } from '../../platform/facebook/read'
import dayjs from 'dayjs'

const getAccounts: ToolDef = {
  name: 'get_accounts',
  description: '获取所有已接入的广告账户列表，包含平台、ID、名称、状态',
  parameters: S.obj('参数', {
    platform: S.enum('平台过滤', ['facebook', 'tiktok', 'all']),
  }),
  handler: async (args) => {
    const query: any = { status: 'active' }
    if (args.platform && args.platform !== 'all') query.platform = args.platform
    const accounts = await AdAccount.find(query).lean()
    return { accounts, count: accounts.length }
  },
}

const getCampaigns: ToolDef = {
  name: 'get_campaigns',
  description: '获取某个 Facebook 广告账户下的所有广告系列（实时从 API 查询），返回 ID、名称、状态、目标、预算',
  parameters: S.obj('参数', {
    accountId: S.str('广告账户 ID（不带 act_ 前缀）'),
  }, ['accountId']),
  handler: async (args, ctx) => {
    const token = await ctx.getToken('facebook', args.accountId)
    if (!token) return { error: '没有可用的 Facebook Token' }
    const campaigns = await fetchCampaigns(args.accountId, token)
    return {
      campaigns: campaigns.map((c: any) => ({
        id: c.id, name: c.name, status: c.status, objective: c.objective,
        dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        bidStrategy: c.bid_strategy,
      })),
      count: campaigns.length,
    }
  },
}

const getAdSets: ToolDef = {
  name: 'get_adsets',
  description: '获取某个 Facebook 广告账户下的所有广告组（实时从 API 查询）',
  parameters: S.obj('参数', {
    accountId: S.str('广告账户 ID'),
  }, ['accountId']),
  handler: async (args, ctx) => {
    const token = await ctx.getToken('facebook', args.accountId)
    if (!token) return { error: '没有可用的 Facebook Token' }
    const adsets = await fetchAdSets(args.accountId, token)
    return {
      adsets: adsets.map((a: any) => ({
        id: a.id, name: a.name, campaignId: a.campaign_id, status: a.status,
        optimizationGoal: a.optimization_goal,
        dailyBudget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
      })),
      count: adsets.length,
    }
  },
}

const getMetrics: ToolDef = {
  name: 'get_metrics',
  description: '从本地数据库查询历史指标数据（花费、ROAS、CTR 等），用于趋势分析。速度快，优先使用。',
  parameters: S.obj('参数', {
    accountId: S.str('按账户 ID 过滤（可选）'),
    campaignId: S.str('按广告系列 ID 过滤（可选）'),
    startDate: S.str('开始日期 YYYY-MM-DD（默认 7 天前）'),
    endDate: S.str('结束日期 YYYY-MM-DD（默认今天）'),
    limit: S.int('最多返回行数（默认 100）'),
  }),
  handler: async (args) => {
    const start = args.startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const end = args.endDate || dayjs().format('YYYY-MM-DD')
    const query: any = { date: { $gte: start, $lte: end } }
    if (args.accountId) query.accountId = args.accountId
    if (args.campaignId) query.campaignId = args.campaignId

    const rows = await Metrics.find(query)
      .sort({ date: -1 })
      .limit(args.limit || 100)
      .lean()

    // 计算汇总
    const totals = rows.reduce((acc: any, r: any) => ({
      spend: acc.spend + (r.spend || 0),
      revenue: acc.revenue + (r.revenue || 0),
      impressions: acc.impressions + (r.impressions || 0),
      clicks: acc.clicks + (r.clicks || 0),
    }), { spend: 0, revenue: 0, impressions: 0, clicks: 0 })

    return {
      dateRange: { start, end },
      totals: {
        ...totals,
        roas: totals.spend > 0 ? +(totals.revenue / totals.spend).toFixed(2) : 0,
      },
      rows,
      count: rows.length,
    }
  },
}

const getLiveInsights: ToolDef = {
  name: 'get_live_insights',
  description: '实时从 Facebook API 查询广告数据。比 get_metrics 慢，但数据最新。只在需要实时数据时使用。',
  parameters: S.obj('参数', {
    entityId: S.str('实体 ID（账户/广告系列/广告组/广告）'),
    level: S.enum('实体级别', ['account', 'campaign', 'adset', 'ad']),
    datePreset: S.enum('时间范围', ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d']),
  }, ['entityId', 'level']),
  handler: async (args, ctx) => {
    const token = await ctx.getToken('facebook')
    if (!token) return { error: '没有可用的 Facebook Token' }
    const data = await fetchInsights(args.entityId, args.level, {
      datePreset: args.datePreset || 'last_7d', token,
    })
    return { data, count: data.length }
  },
}

export const readTools: ToolDef[] = [
  getAccounts,
  getCampaigns,
  getAdSets,
  getMetrics,
  getLiveInsights,
]
