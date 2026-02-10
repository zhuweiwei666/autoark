/**
 * Facebook Platform Tools
 * 
 * Wraps the existing Facebook integration APIs as structured agent tools.
 * Covers: Campaign CRUD, AdSet CRUD, Ad CRUD, Creative, Budget, Status, Search.
 */

import { ToolDefinition, AgentContext, ToolResult } from '../core/agent.types'
import {
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  updateCampaign,
  updateAdSet,
  updateAd,
  uploadImageFromUrl,
  uploadVideoFromUrl,
  searchTargetingInterests,
  searchTargetingLocations,
  getPages,
  getPixels,
  getCustomConversions,
} from '../../integration/facebook/bulkCreate.api'
import { fetchCampaigns } from '../../integration/facebook/campaigns.api'
import { fetchInsights } from '../../integration/facebook/insights.api'
import FbToken from '../../models/FbToken'
import logger from '../../utils/logger'

/**
 * Resolve a Facebook access token for the given context.
 * Priority: context.fbToken > scope.fbTokenIds > any active org token
 */
async function resolveToken(context: AgentContext): Promise<string | null> {
  if (context.fbToken) return context.fbToken

  // Try tokens from scope
  if (context.scope.fbTokenIds.length > 0) {
    const tokenDoc = await FbToken.findOne({
      _id: { $in: context.scope.fbTokenIds },
      status: 'active',
    }).lean() as any
    if (tokenDoc) return tokenDoc.token
  }

  // Fallback: any active token in the org
  if (context.organizationId) {
    const tokenDoc = await FbToken.findOne({
      organizationId: context.organizationId,
      status: 'active',
    }).lean() as any
    if (tokenDoc) return tokenDoc.token
  }

  return null
}

// ==================== Read Tools ====================

const getCampaignsTool: ToolDefinition = {
  name: 'get_campaigns',
  description: 'Get all campaigns for a Facebook ad account. Returns campaign IDs, names, status, objectives, and budgets.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: {
        type: 'STRING',
        description: 'Facebook ad account ID (without act_ prefix)',
      },
    },
    required: ['accountId'],
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    try {
      const campaigns = await fetchCampaigns(args.accountId, token)
      return {
        success: true,
        data: campaigns.map((c: any) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          objective: c.objective,
          dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
          lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
          bidStrategy: c.bid_strategy,
          buyingType: c.buying_type,
        })),
        metadata: { count: campaigns.length },
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const getCampaignInsightsTool: ToolDefinition = {
  name: 'get_campaign_insights',
  description: 'Get performance insights (spend, impressions, clicks, ROAS, etc.) for a campaign, ad set, or ad. Supports date presets and country breakdown.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      entityId: {
        type: 'STRING',
        description: 'Campaign ID, AdSet ID, or Ad ID to get insights for',
      },
      level: {
        type: 'STRING',
        description: 'Entity level',
        enum: ['campaign', 'adset', 'ad'],
      },
      datePreset: {
        type: 'STRING',
        description: 'Date preset for the report period',
        enum: ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d'],
      },
      breakdownByCountry: {
        type: 'BOOLEAN',
        description: 'Whether to break down results by country',
      },
    },
    required: ['entityId', 'level'],
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    try {
      const breakdowns = args.breakdownByCountry ? ['country'] : undefined
      const insights = await fetchInsights(
        args.entityId,
        args.level,
        args.datePreset || 'last_7d',
        token,
        breakdowns
      )
      return {
        success: true,
        data: insights,
        metadata: { rows: insights.length },
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const getPagesTool: ToolDefinition = {
  name: 'get_pages',
  description: 'Get Facebook Pages available for an ad account. Needed for creating ad creatives.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: {
        type: 'STRING',
        description: 'Facebook ad account ID (without act_ prefix)',
      },
    },
    required: ['accountId'],
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }
    const result = await getPages(args.accountId, token)
    return { success: result.success, data: result.data, error: result.error }
  },
}

const getPixelsTool: ToolDefinition = {
  name: 'get_pixels',
  description: 'Get Facebook Pixels for an ad account. Needed for conversion optimization.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: {
        type: 'STRING',
        description: 'Facebook ad account ID (without act_ prefix)',
      },
    },
    required: ['accountId'],
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }
    const result = await getPixels(args.accountId, token)
    return { success: result.success, data: result.data, error: result.error }
  },
}

const searchInterestsTool: ToolDefinition = {
  name: 'search_interests',
  description: 'Search for targeting interests on Facebook. Use this to find interest-based audiences for ad targeting.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: {
        type: 'STRING',
        description: 'Search query for interests (e.g. "fitness", "cooking", "technology")',
      },
    },
    required: ['query'],
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }
    const result = await searchTargetingInterests({ token, query: args.query })
    return { success: result.success, data: result.data, error: result.error }
  },
}

const searchLocationsTool: ToolDefinition = {
  name: 'search_locations',
  description: 'Search for geographic targeting locations on Facebook.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: {
        type: 'STRING',
        description: 'Search query for locations (e.g. "United States", "New York")',
      },
    },
    required: ['query'],
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }
    const result = await searchTargetingLocations({ token, query: args.query })
    return { success: result.success, data: result.data, error: result.error }
  },
}

// ==================== Write Tools ====================

const createCampaignTool: ToolDefinition = {
  name: 'create_campaign',
  description: 'Create a new Facebook ad campaign. Requires account ID, name, objective, and status.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: { type: 'STRING', description: 'Ad account ID (without act_ prefix)' },
      name: { type: 'STRING', description: 'Campaign name' },
      objective: {
        type: 'STRING',
        description: 'Campaign objective',
        enum: ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION'],
      },
      status: { type: 'STRING', description: 'Initial status', enum: ['ACTIVE', 'PAUSED'] },
      dailyBudget: { type: 'NUMBER', description: 'Daily budget in USD' },
      bidStrategy: { type: 'STRING', description: 'Bid strategy', enum: ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'] },
      reason: { type: 'STRING', description: 'Why this campaign is being created' },
    },
    required: ['accountId', 'name', 'objective', 'status', 'reason'],
  },
  guardrails: {
    requiredPermission: 'canCreateCampaigns',
    cooldownMinutes: 5,
    maxCallsPerRun: 10,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    const result = await createCampaign({
      accountId: args.accountId,
      token,
      name: args.name,
      objective: args.objective,
      status: args.status,
      dailyBudget: args.dailyBudget,
      bidStrategy: args.bidStrategy,
    })
    return {
      success: result.success,
      data: result.success ? { campaignId: result.id } : undefined,
      error: result.success ? undefined : result.error?.message,
    }
  },
}

const createAdSetTool: ToolDefinition = {
  name: 'create_adset',
  description: 'Create a new Facebook Ad Set within a campaign. Requires targeting, optimization goal, and budget.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: { type: 'STRING', description: 'Ad account ID (without act_ prefix)' },
      campaignId: { type: 'STRING', description: 'Parent campaign ID' },
      name: { type: 'STRING', description: 'Ad set name' },
      status: { type: 'STRING', description: 'Initial status', enum: ['ACTIVE', 'PAUSED'] },
      countries: { type: 'ARRAY', description: 'Target country codes (e.g. ["US", "GB"])', items: { type: 'STRING', description: 'Country code' } },
      optimizationGoal: { type: 'STRING', description: 'What to optimize for', enum: ['OFFSITE_CONVERSIONS', 'APP_INSTALLS', 'LINK_CLICKS', 'IMPRESSIONS', 'REACH', 'VALUE'] },
      billingEvent: { type: 'STRING', description: 'Billing event', enum: ['IMPRESSIONS', 'LINK_CLICKS'] },
      dailyBudget: { type: 'NUMBER', description: 'Daily budget in USD' },
      pixelId: { type: 'STRING', description: 'Pixel ID for conversion tracking' },
      customEventType: { type: 'STRING', description: 'Custom event type for optimization', enum: ['PURCHASE', 'ADD_TO_CART', 'INITIATED_CHECKOUT', 'LEAD', 'COMPLETE_REGISTRATION'] },
      reason: { type: 'STRING', description: 'Why this ad set is being created' },
    },
    required: ['accountId', 'campaignId', 'name', 'status', 'countries', 'optimizationGoal', 'billingEvent', 'reason'],
  },
  guardrails: {
    requiredPermission: 'canCreateCampaigns',
    cooldownMinutes: 5,
    maxCallsPerRun: 20,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    const targeting: any = {
      geo_locations: { countries: args.countries },
    }

    const promotedObject: any = {}
    if (args.pixelId) {
      promotedObject.pixel_id = args.pixelId
      if (args.customEventType) {
        promotedObject.custom_event_type = args.customEventType
      }
    }

    const result = await createAdSet({
      accountId: args.accountId,
      token,
      campaignId: args.campaignId,
      name: args.name,
      status: args.status,
      targeting,
      optimizationGoal: args.optimizationGoal,
      billingEvent: args.billingEvent,
      dailyBudget: args.dailyBudget,
      promotedObject: Object.keys(promotedObject).length > 0 ? promotedObject : undefined,
    })
    return {
      success: result.success,
      data: result.success ? { adsetId: result.id } : undefined,
      error: result.success ? undefined : result.error?.message,
    }
  },
}

const createAdCreativeTool: ToolDefinition = {
  name: 'create_ad_creative',
  description: 'Create a Facebook Ad Creative with an image or video. Requires a page ID and either an image hash or video ID.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: { type: 'STRING', description: 'Ad account ID' },
      name: { type: 'STRING', description: 'Creative name' },
      pageId: { type: 'STRING', description: 'Facebook Page ID' },
      message: { type: 'STRING', description: 'Primary text (post body)' },
      linkUrl: { type: 'STRING', description: 'Destination URL' },
      headline: { type: 'STRING', description: 'Ad headline' },
      description: { type: 'STRING', description: 'Ad description' },
      callToAction: { type: 'STRING', description: 'Call to action type', enum: ['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'INSTALL_NOW', 'BUY_NOW', 'GET_OFFER'] },
      imageHash: { type: 'STRING', description: 'Image hash (from upload_image)' },
      videoId: { type: 'STRING', description: 'Video ID (from upload_video)' },
      reason: { type: 'STRING', description: 'Why this creative is being created' },
    },
    required: ['accountId', 'name', 'pageId', 'message', 'linkUrl', 'reason'],
  },
  guardrails: {
    requiredPermission: 'canModifyCreatives',
    maxCallsPerRun: 20,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    const objectStorySpec: any = {
      page_id: args.pageId,
    }

    if (args.videoId) {
      objectStorySpec.video_data = {
        video_id: args.videoId,
        message: args.message,
        title: args.headline,
        link_description: args.description,
        call_to_action: {
          type: args.callToAction || 'SHOP_NOW',
          value: { link: args.linkUrl },
        },
      }
    } else {
      objectStorySpec.link_data = {
        message: args.message,
        link: args.linkUrl,
        name: args.headline,
        description: args.description,
        call_to_action: {
          type: args.callToAction || 'SHOP_NOW',
          value: { link: args.linkUrl },
        },
        ...(args.imageHash ? { image_hash: args.imageHash } : {}),
      }
    }

    const result = await createAdCreative({
      accountId: args.accountId,
      token,
      name: args.name,
      objectStorySpec,
    })
    return {
      success: result.success,
      data: result.success ? { creativeId: result.id } : undefined,
      error: result.success ? undefined : result.error?.message,
    }
  },
}

const createAdTool: ToolDefinition = {
  name: 'create_ad',
  description: 'Create a Facebook Ad linking an ad set to a creative.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: { type: 'STRING', description: 'Ad account ID' },
      adsetId: { type: 'STRING', description: 'Ad set ID' },
      creativeId: { type: 'STRING', description: 'Creative ID' },
      name: { type: 'STRING', description: 'Ad name' },
      status: { type: 'STRING', description: 'Initial status', enum: ['ACTIVE', 'PAUSED'] },
      reason: { type: 'STRING', description: 'Why this ad is being created' },
    },
    required: ['accountId', 'adsetId', 'creativeId', 'name', 'status', 'reason'],
  },
  guardrails: {
    requiredPermission: 'canPublishAds',
    maxCallsPerRun: 50,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    const result = await createAd({
      accountId: args.accountId,
      token,
      adsetId: args.adsetId,
      creativeId: args.creativeId,
      name: args.name,
      status: args.status,
    })
    return {
      success: result.success,
      data: result.success ? { adId: result.id } : undefined,
      error: result.success ? undefined : result.error?.message,
    }
  },
}

const adjustBudgetTool: ToolDefinition = {
  name: 'adjust_budget',
  description: 'Adjust the daily budget of a Facebook campaign or ad set. Provide the new budget amount in USD.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      entityType: { type: 'STRING', description: 'Entity type', enum: ['campaign', 'adset'] },
      entityId: { type: 'STRING', description: 'Campaign or AdSet ID' },
      newBudget: { type: 'NUMBER', description: 'New daily budget in USD' },
      currentBudget: { type: 'NUMBER', description: 'Current daily budget in USD (for guardrail check)' },
      reason: { type: 'STRING', description: 'Why the budget is being adjusted' },
    },
    required: ['entityType', 'entityId', 'newBudget', 'reason'],
  },
  guardrails: {
    requiredPermission: 'canAdjustBudget',
    maxChangePercent: 50,
    cooldownMinutes: 240, // 4 hours
    minBudget: 5,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    let result
    if (args.entityType === 'campaign') {
      result = await updateCampaign({
        campaignId: args.entityId,
        token,
        dailyBudget: args.newBudget,
      })
    } else {
      result = await updateAdSet({
        adsetId: args.entityId,
        token,
        dailyBudget: args.newBudget,
      })
    }

    return {
      success: result.success,
      data: { entityId: args.entityId, newBudget: args.newBudget },
      error: result.success ? undefined : result.error?.message,
    }
  },
}

const pauseEntityTool: ToolDefinition = {
  name: 'pause_entity',
  description: 'Pause a Facebook campaign, ad set, or ad.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      entityType: { type: 'STRING', description: 'Entity type', enum: ['campaign', 'adset', 'ad'] },
      entityId: { type: 'STRING', description: 'Entity ID' },
      reason: { type: 'STRING', description: 'Why this entity is being paused' },
    },
    required: ['entityType', 'entityId', 'reason'],
  },
  guardrails: {
    requiredPermission: 'canPause',
    cooldownMinutes: 240, // 4 hours
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    let result
    if (args.entityType === 'campaign') {
      result = await updateCampaign({ campaignId: args.entityId, token, status: 'PAUSED' })
    } else if (args.entityType === 'adset') {
      result = await updateAdSet({ adsetId: args.entityId, token, status: 'PAUSED' })
    } else {
      result = await updateAd({ adId: args.entityId, token, status: 'PAUSED' })
    }
    return {
      success: result.success,
      data: { entityId: args.entityId, status: 'PAUSED' },
      error: result.success ? undefined : result.error?.message,
    }
  },
}

const resumeEntityTool: ToolDefinition = {
  name: 'resume_entity',
  description: 'Resume (activate) a paused Facebook campaign, ad set, or ad.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      entityType: { type: 'STRING', description: 'Entity type', enum: ['campaign', 'adset', 'ad'] },
      entityId: { type: 'STRING', description: 'Entity ID' },
      reason: { type: 'STRING', description: 'Why this entity is being resumed' },
    },
    required: ['entityType', 'entityId', 'reason'],
  },
  guardrails: {
    requiredPermission: 'canResume',
    cooldownMinutes: 240,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    let result
    if (args.entityType === 'campaign') {
      result = await updateCampaign({ campaignId: args.entityId, token, status: 'ACTIVE' })
    } else if (args.entityType === 'adset') {
      result = await updateAdSet({ adsetId: args.entityId, token, status: 'ACTIVE' })
    } else {
      result = await updateAd({ adId: args.entityId, token, status: 'ACTIVE' })
    }
    return {
      success: result.success,
      data: { entityId: args.entityId, status: 'ACTIVE' },
      error: result.success ? undefined : result.error?.message,
    }
  },
}

const uploadImageTool: ToolDefinition = {
  name: 'upload_image',
  description: 'Upload an image from URL to a Facebook ad account. Returns an image hash for use in creatives.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: { type: 'STRING', description: 'Ad account ID' },
      imageUrl: { type: 'STRING', description: 'URL of the image to upload' },
      name: { type: 'STRING', description: 'Image name' },
    },
    required: ['accountId', 'imageUrl'],
  },
  guardrails: {
    requiredPermission: 'canModifyCreatives',
    maxCallsPerRun: 20,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    const result = await uploadImageFromUrl({
      accountId: args.accountId,
      token,
      imageUrl: args.imageUrl,
      name: args.name,
    })
    return {
      success: result.success,
      data: result.success ? { imageHash: result.hash } : undefined,
      error: result.success ? undefined : result.error?.message,
    }
  },
}

const uploadVideoTool: ToolDefinition = {
  name: 'upload_video',
  description: 'Upload a video from URL to a Facebook ad account. Returns a video ID for use in creatives.',
  category: 'facebook',
  parameters: {
    type: 'OBJECT',
    properties: {
      accountId: { type: 'STRING', description: 'Ad account ID' },
      videoUrl: { type: 'STRING', description: 'URL of the video to upload' },
      title: { type: 'STRING', description: 'Video title' },
    },
    required: ['accountId', 'videoUrl'],
  },
  guardrails: {
    requiredPermission: 'canModifyCreatives',
    maxCallsPerRun: 10,
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const token = await resolveToken(context)
    if (!token) return { success: false, error: 'No Facebook access token available' }

    const result = await uploadVideoFromUrl({
      accountId: args.accountId,
      token,
      videoUrl: args.videoUrl,
      title: args.title,
    })
    return {
      success: result.success,
      data: result.success ? { videoId: result.id, thumbnailUrl: result.thumbnailUrl } : undefined,
      error: result.success ? undefined : result.error?.message,
    }
  },
}

// ==================== Export All Facebook Tools ====================

export const facebookTools: ToolDefinition[] = [
  // Read
  getCampaignsTool,
  getCampaignInsightsTool,
  getPagesTool,
  getPixelsTool,
  searchInterestsTool,
  searchLocationsTool,
  // Write
  createCampaignTool,
  createAdSetTool,
  createAdCreativeTool,
  createAdTool,
  adjustBudgetTool,
  pauseEntityTool,
  resumeEntityTool,
  uploadImageTool,
  uploadVideoTool,
]

export default facebookTools
