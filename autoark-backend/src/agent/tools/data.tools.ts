/**
 * Data Query Tools
 * 
 * Provides agents with read access to all pre-aggregated data:
 * - MetricsDaily (raw daily metrics)
 * - Aggregation tables (AggDaily, AggAccount, AggCampaign, etc.)
 * - Account and Campaign metadata
 */

import { ToolDefinition, AgentContext, ToolResult } from '../core/agent.types'
import MetricsDaily from '../../models/MetricsDaily'
import Campaign from '../../models/Campaign'
import AdSet from '../../models/AdSet'
import Ad from '../../models/Ad'
import Account from '../../models/Account'
import { AggDaily, AggAccount, AggCampaign, AggCountry } from '../../models/Aggregation'
import dayjs from 'dayjs'

const queryAccountsTool: ToolDefinition = {
  name: 'query_accounts',
  description: 'Get all ad accounts in scope with their basic info and status.',
  category: 'data',
  parameters: {
    type: 'OBJECT',
    properties: {
      platform: {
        type: 'STRING',
        description: 'Filter by platform',
        enum: ['facebook', 'tiktok', 'all'],
      },
    },
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const query: any = {}
    if (context.scope.adAccountIds.length > 0) {
      query.accountId = { $in: context.scope.adAccountIds }
    }
    if (context.organizationId) {
      query.organizationId = context.organizationId
    }
    if (args.platform && args.platform !== 'all') {
      query.channel = args.platform
    }

    const accounts = await Account.find(query)
      .select('accountId name channel status tags groupId')
      .lean()

    return {
      success: true,
      data: accounts,
      metadata: { count: accounts.length },
    }
  },
}

const queryDailyMetricsTool: ToolDefinition = {
  name: 'query_daily_metrics',
  description: 'Query daily performance metrics for campaigns, ad sets, or ads. Returns spend, impressions, clicks, ROAS, CPA, etc.',
  category: 'data',
  parameters: {
    type: 'OBJECT',
    properties: {
      level: {
        type: 'STRING',
        description: 'Level of the entity',
        enum: ['account', 'campaign', 'adset', 'ad'],
      },
      entityId: { type: 'STRING', description: 'Entity ID (campaign/adset/ad ID)' },
      accountId: { type: 'STRING', description: 'Filter by account ID' },
      startDate: { type: 'STRING', description: 'Start date (YYYY-MM-DD)' },
      endDate: { type: 'STRING', description: 'End date (YYYY-MM-DD)' },
      country: { type: 'STRING', description: 'Filter by country code' },
      limit: { type: 'INTEGER', description: 'Max rows to return (default 100)' },
    },
    required: ['level'],
  },
  handler: async (args: any, _context: AgentContext): Promise<ToolResult> => {
    const query: any = { level: args.level }

    if (args.entityId) query.entityId = args.entityId
    if (args.accountId) query.accountId = args.accountId
    if (args.country) query.country = args.country

    const startDate = args.startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const endDate = args.endDate || dayjs().format('YYYY-MM-DD')
    query.date = { $gte: startDate, $lte: endDate }

    const metrics = await MetricsDaily.find(query)
      .select('date entityId accountId campaignId country spendUsd impressions clicks ctr cpm cpc purchase_value purchase_roas installs')
      .sort({ date: -1 })
      .limit(args.limit || 100)
      .lean()

    // Compute derived metrics
    const enriched = metrics.map((m: any) => ({
      ...m,
      roas: m.spendUsd > 0 ? ((m.purchase_value || 0) / m.spendUsd).toFixed(2) : '0',
      cpa: m.installs > 0 ? (m.spendUsd / m.installs).toFixed(2) : null,
    }))

    return {
      success: true,
      data: enriched,
      metadata: { rows: enriched.length, dateRange: `${startDate} to ${endDate}` },
    }
  },
}

const queryDashboardSummaryTool: ToolDefinition = {
  name: 'query_dashboard_summary',
  description: 'Get aggregated dashboard summary metrics for a date range. Shows total spend, revenue, ROAS, impressions, clicks across all accounts.',
  category: 'data',
  parameters: {
    type: 'OBJECT',
    properties: {
      startDate: { type: 'STRING', description: 'Start date (YYYY-MM-DD)' },
      endDate: { type: 'STRING', description: 'End date (YYYY-MM-DD)' },
    },
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const startDate = args.startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const endDate = args.endDate || dayjs().format('YYYY-MM-DD')

    const query: any = { date: { $gte: startDate, $lte: endDate } }

    const dailyData = await AggDaily.find(query).sort({ date: -1 }).lean()

    // Aggregate totals
    const totals = dailyData.reduce(
      (acc: any, d: any) => ({
        spend: acc.spend + (d.spend || 0),
        revenue: acc.revenue + (d.revenue || 0),
        impressions: acc.impressions + (d.impressions || 0),
        clicks: acc.clicks + (d.clicks || 0),
        installs: acc.installs + (d.installs || 0),
      }),
      { spend: 0, revenue: 0, impressions: 0, clicks: 0, installs: 0 }
    )

    return {
      success: true,
      data: {
        dateRange: { start: startDate, end: endDate },
        totals: {
          ...totals,
          roas: totals.spend > 0 ? (totals.revenue / totals.spend).toFixed(2) : '0',
          ctr: totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) + '%' : '0%',
        },
        daily: dailyData,
      },
    }
  },
}

const queryAccountPerformanceTool: ToolDefinition = {
  name: 'query_account_performance',
  description: 'Get per-account performance breakdown for a date range.',
  category: 'data',
  parameters: {
    type: 'OBJECT',
    properties: {
      startDate: { type: 'STRING', description: 'Start date (YYYY-MM-DD)' },
      endDate: { type: 'STRING', description: 'End date (YYYY-MM-DD)' },
    },
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const startDate = args.startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const endDate = args.endDate || dayjs().format('YYYY-MM-DD')

    const query: any = { date: { $gte: startDate, $lte: endDate } }
    if (context.scope.adAccountIds.length > 0) {
      query.accountId = { $in: context.scope.adAccountIds }
    }

    const accountData = await AggAccount.find(query).sort({ spend: -1 }).lean()

    return {
      success: true,
      data: accountData,
      metadata: { count: accountData.length },
    }
  },
}

const queryCampaignPerformanceTool: ToolDefinition = {
  name: 'query_campaign_performance',
  description: 'Get per-campaign performance breakdown for a date range. Shows each campaign with spend, ROAS, CPA, status.',
  category: 'data',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: { type: 'STRING', description: 'Filter by account ID' },
      startDate: { type: 'STRING', description: 'Start date (YYYY-MM-DD)' },
      endDate: { type: 'STRING', description: 'End date (YYYY-MM-DD)' },
      sortBy: { type: 'STRING', description: 'Sort field', enum: ['spend', 'roas', 'impressions'] },
      limit: { type: 'INTEGER', description: 'Max rows (default 50)' },
    },
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const startDate = args.startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const endDate = args.endDate || dayjs().format('YYYY-MM-DD')

    const query: any = { date: { $gte: startDate, $lte: endDate } }
    if (args.accountId) query.accountId = args.accountId
    if (context.scope.adAccountIds.length > 0 && !args.accountId) {
      query.accountId = { $in: context.scope.adAccountIds }
    }

    const sortField = args.sortBy || 'spend'
    const campaignData = await AggCampaign.find(query)
      .sort({ [sortField]: -1 })
      .limit(args.limit || 50)
      .lean()

    return {
      success: true,
      data: campaignData,
      metadata: { count: campaignData.length },
    }
  },
}

const queryCountryPerformanceTool: ToolDefinition = {
  name: 'query_country_performance',
  description: 'Get performance breakdown by country for a date range.',
  category: 'data',
  parameters: {
    type: 'OBJECT',
    properties: {
      startDate: { type: 'STRING', description: 'Start date (YYYY-MM-DD)' },
      endDate: { type: 'STRING', description: 'End date (YYYY-MM-DD)' },
    },
  },
  handler: async (args: any, _context: AgentContext): Promise<ToolResult> => {
    const startDate = args.startDate || dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const endDate = args.endDate || dayjs().format('YYYY-MM-DD')

    const countryData = await AggCountry.find({
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ spend: -1 })
      .lean()

    return {
      success: true,
      data: countryData,
      metadata: { count: countryData.length },
    }
  },
}

const getCampaignDetailsTool: ToolDefinition = {
  name: 'get_campaign_details',
  description: 'Get detailed information about a specific campaign including its ad sets and ads.',
  category: 'data',
  parameters: {
    type: 'OBJECT',
    properties: {
      campaignId: { type: 'STRING', description: 'Campaign ID' },
    },
    required: ['campaignId'],
  },
  handler: async (args: any, _context: AgentContext): Promise<ToolResult> => {
    const campaign = await Campaign.findOne({ campaignId: args.campaignId }).lean()
    if (!campaign) return { success: false, error: `Campaign ${args.campaignId} not found` }

    const adSets = await AdSet.find({ campaignId: args.campaignId })
      .select('adsetId name status optimizationGoal')
      .lean()

    const ads = await Ad.find({ campaignId: args.campaignId })
      .select('adId adsetId name effectiveStatus creativeId materialId')
      .lean()

    return {
      success: true,
      data: {
        campaign,
        adSets,
        ads,
        summary: {
          totalAdSets: adSets.length,
          totalAds: ads.length,
        },
      },
    }
  },
}

export const dataTools: ToolDefinition[] = [
  queryAccountsTool,
  queryDailyMetricsTool,
  queryDashboardSummaryTool,
  queryAccountPerformanceTool,
  queryCampaignPerformanceTool,
  queryCountryPerformanceTool,
  getCampaignDetailsTool,
]

export default dataTools
