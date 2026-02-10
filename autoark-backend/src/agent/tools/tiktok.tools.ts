/**
 * TikTok Platform Tools
 * 
 * Wraps the existing TikTok integration APIs as structured agent tools.
 */

import { ToolDefinition, AgentContext, ToolResult } from '../core/agent.types'
import { updateTiktokCampaign, updateTiktokAdGroup } from '../../integration/tiktok/management.api'
import { fetchTiktokInsights, fetchTiktokCampaigns, fetchTiktokAdGroups } from '../../integration/tiktok/insights.api'
import TiktokTokenModel from '../../models/TiktokToken'
import logger from '../../utils/logger'

/**
 * Resolve TikTok access token and advertiser ID
 */
async function resolveTiktokAuth(context: AgentContext): Promise<{ token: string; advertiserId: string } | null> {
  if (context.tiktokToken) {
    const tokenDoc = await TiktokTokenModel.findOne({
      accessToken: context.tiktokToken,
      status: 'active',
    }).lean() as any
    if (tokenDoc && tokenDoc.advertiserIds?.length > 0) {
      return { token: context.tiktokToken, advertiserId: tokenDoc.advertiserIds[0] }
    }
  }

  if (context.scope.tiktokTokenIds.length > 0) {
    const tokenDoc = await TiktokTokenModel.findOne({
      _id: { $in: context.scope.tiktokTokenIds },
      status: 'active',
    }).lean() as any
    if (tokenDoc && tokenDoc.advertiserIds?.length > 0) {
      return { token: tokenDoc.accessToken, advertiserId: tokenDoc.advertiserIds[0] }
    }
  }

  if (context.organizationId) {
    const tokenDoc = await TiktokTokenModel.findOne({
      organizationId: context.organizationId,
      status: 'active',
    }).lean() as any
    if (tokenDoc && tokenDoc.advertiserIds?.length > 0) {
      return { token: tokenDoc.accessToken, advertiserId: tokenDoc.advertiserIds[0] }
    }
  }

  return null
}

const getTiktokCampaignsTool: ToolDefinition = {
  name: 'get_tiktok_campaigns',
  description: 'Get all TikTok ad campaigns for the current advertiser.',
  category: 'tiktok',
  parameters: {
    type: 'OBJECT',
    properties: {
      advertiserId: {
        type: 'STRING',
        description: 'TikTok advertiser ID (optional, uses default from scope if not provided)',
      },
    },
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const auth = await resolveTiktokAuth(context)
    if (!auth) return { success: false, error: 'No TikTok access token available' }

    try {
      const campaigns = await fetchTiktokCampaigns(
        args.advertiserId || auth.advertiserId,
        auth.token
      )
      return { success: true, data: campaigns, metadata: { count: campaigns?.length || 0 } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const getTiktokInsightsTool: ToolDefinition = {
  name: 'get_tiktok_insights',
  description: 'Get TikTok campaign/ad group performance insights for a date range.',
  category: 'tiktok',
  parameters: {
    type: 'OBJECT',
    properties: {
      advertiserId: { type: 'STRING', description: 'TikTok advertiser ID' },
      level: { type: 'STRING', description: 'Report level', enum: ['AUCTION_CAMPAIGN', 'AUCTION_ADGROUP', 'AUCTION_AD'] },
      startDate: { type: 'STRING', description: 'Start date (YYYY-MM-DD)' },
      endDate: { type: 'STRING', description: 'End date (YYYY-MM-DD)' },
    },
    required: ['level', 'startDate', 'endDate'],
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const auth = await resolveTiktokAuth(context)
    if (!auth) return { success: false, error: 'No TikTok access token available' }

    try {
      const insights = await fetchTiktokInsights(
        args.advertiserId || auth.advertiserId,
        args.level,
        'BASIC',
        {
          start_date: args.startDate,
          end_date: args.endDate,
        },
        auth.token,
      )
      return { success: true, data: insights }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const updateTiktokCampaignTool: ToolDefinition = {
  name: 'update_tiktok_campaign',
  description: 'Update a TikTok campaign status or budget.',
  category: 'tiktok',
  parameters: {
    type: 'OBJECT',
    properties: {
      campaignId: { type: 'STRING', description: 'TikTok campaign ID' },
      advertiserId: { type: 'STRING', description: 'TikTok advertiser ID' },
      status: { type: 'STRING', description: 'New status', enum: ['ENABLE', 'DISABLE'] },
      budgetAmount: { type: 'NUMBER', description: 'New daily budget amount' },
      reason: { type: 'STRING', description: 'Reason for the change' },
    },
    required: ['campaignId', 'reason'],
  },
  guardrails: {
    requiredPermission: 'canAdjustBudget',
    cooldownMinutes: 240,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const auth = await resolveTiktokAuth(context)
    if (!auth) return { success: false, error: 'No TikTok access token available' }

    try {
      const updates: any = {}
      if (args.status) updates.operation_status = args.status
      if (args.budgetAmount) updates.budget = args.budgetAmount

      await updateTiktokCampaign(
        args.advertiserId || auth.advertiserId,
        args.campaignId,
        updates,
        auth.token,
      )
      return { success: true, data: { campaignId: args.campaignId, ...updates } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const updateTiktokAdGroupTool: ToolDefinition = {
  name: 'update_tiktok_adgroup',
  description: 'Update a TikTok ad group status or budget.',
  category: 'tiktok',
  parameters: {
    type: 'OBJECT',
    properties: {
      adGroupId: { type: 'STRING', description: 'TikTok ad group ID' },
      advertiserId: { type: 'STRING', description: 'TikTok advertiser ID' },
      status: { type: 'STRING', description: 'New status', enum: ['ENABLE', 'DISABLE'] },
      budgetAmount: { type: 'NUMBER', description: 'New daily budget amount' },
      reason: { type: 'STRING', description: 'Reason for the change' },
    },
    required: ['adGroupId', 'reason'],
  },
  guardrails: {
    requiredPermission: 'canAdjustBudget',
    cooldownMinutes: 240,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const auth = await resolveTiktokAuth(context)
    if (!auth) return { success: false, error: 'No TikTok access token available' }

    try {
      const updates: any = {}
      if (args.status) updates.operation_status = args.status
      if (args.budgetAmount) updates.budget = args.budgetAmount

      await updateTiktokAdGroup(
        args.advertiserId || auth.advertiserId,
        args.adGroupId,
        updates,
        auth.token,
      )
      return { success: true, data: { adGroupId: args.adGroupId, ...updates } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

export const tiktokTools: ToolDefinition[] = [
  getTiktokCampaignsTool,
  getTiktokInsightsTool,
  updateTiktokCampaignTool,
  updateTiktokAdGroupTool,
]

export default tiktokTools
