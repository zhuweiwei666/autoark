import { facebookClient } from './facebookClient'
import logger from '../../utils/logger'

/**
 * Facebook 批量创建 API 集成
 * 用于创建 Campaign, AdSet, Ad, Creative
 */

// ==================== Campaign 创建 ====================

export interface CreateCampaignParams {
  accountId: string
  token: string
  name: string
  objective: string
  status: string
  buyingType?: string
  specialAdCategories?: string[]
  dailyBudget?: number
  lifetimeBudget?: number
  bidStrategy?: string
  spendCap?: number
}

export const createCampaign = async (params: CreateCampaignParams) => {
  const {
    accountId,
    token,
    name,
    objective,
    status,
    buyingType = 'AUCTION',
    specialAdCategories = [],
    dailyBudget,
    lifetimeBudget,
    bidStrategy,
    spendCap,
  } = params

  const requestParams: any = {
    access_token: token,
    name,
    objective,
    status,
    buying_type: buyingType,
    special_ad_categories: JSON.stringify(specialAdCategories),
  }

  // 预算设置（只有非 CBO 模式下才设置）
  if (dailyBudget && !lifetimeBudget) {
    requestParams.daily_budget = Math.round(dailyBudget * 100) // 转换为分
  }
  if (lifetimeBudget) {
    requestParams.lifetime_budget = Math.round(lifetimeBudget * 100)
  }

  if (bidStrategy) {
    requestParams.bid_strategy = bidStrategy
  }

  if (spendCap) {
    requestParams.spend_cap = Math.round(spendCap * 100)
  }

  try {
    logger.info(`[BulkCreate] Creating campaign for account ${accountId}: ${name}`)
    const res = await facebookClient.post(`/act_${accountId}/campaigns`, requestParams)
    logger.info(`[BulkCreate] Campaign created: ${res.id}`)
    return { success: true, id: res.id, data: res }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to create campaign:`, error.response?.data || error.message)
    return {
      success: false,
      error: {
        code: error.response?.data?.error?.code || 'UNKNOWN',
        message: error.response?.data?.error?.message || error.message,
        details: error.response?.data,
      },
    }
  }
}

// ==================== AdSet 创建 ====================

export interface CreateAdSetParams {
  accountId: string
  token: string
  campaignId: string
  name: string
  status: string
  targeting: any
  optimizationGoal: string
  billingEvent: string
  bidStrategy?: string
  bidAmount?: number
  dailyBudget?: number
  lifetimeBudget?: number
  startTime?: string
  endTime?: string
  promotedObject?: any
  attribution_spec?: any
  pacing_type?: string[]
}

export const createAdSet = async (params: CreateAdSetParams) => {
  const {
    accountId,
    token,
    campaignId,
    name,
    status,
    targeting,
    optimizationGoal,
    billingEvent,
    bidStrategy,
    bidAmount,
    dailyBudget,
    lifetimeBudget,
    startTime,
    endTime,
    promotedObject,
    attribution_spec,
    pacing_type,
  } = params

  const requestParams: any = {
    access_token: token,
    campaign_id: campaignId,
    name,
    status,
    targeting: JSON.stringify(targeting),
    optimization_goal: optimizationGoal,
    billing_event: billingEvent,
  }

  if (bidStrategy) {
    requestParams.bid_strategy = bidStrategy
  }
  if (bidAmount) {
    requestParams.bid_amount = Math.round(bidAmount * 100)
  }
  if (dailyBudget) {
    requestParams.daily_budget = Math.round(dailyBudget * 100)
  }
  if (lifetimeBudget) {
    requestParams.lifetime_budget = Math.round(lifetimeBudget * 100)
  }
  if (startTime) {
    requestParams.start_time = startTime
  }
  if (endTime) {
    requestParams.end_time = endTime
  }
  if (promotedObject) {
    requestParams.promoted_object = JSON.stringify(promotedObject)
  }
  if (attribution_spec) {
    requestParams.attribution_spec = JSON.stringify(attribution_spec)
  }
  if (pacing_type) {
    requestParams.pacing_type = JSON.stringify(pacing_type)
  }

  try {
    logger.info(`[BulkCreate] Creating adset for campaign ${campaignId}: ${name}`)
    const res = await facebookClient.post(`/act_${accountId}/adsets`, requestParams)
    logger.info(`[BulkCreate] AdSet created: ${res.id}`)
    return { success: true, id: res.id, data: res }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to create adset:`, error.response?.data || error.message)
    return {
      success: false,
      error: {
        code: error.response?.data?.error?.code || 'UNKNOWN',
        message: error.response?.data?.error?.message || error.message,
        details: error.response?.data,
      },
    }
  }
}

// ==================== Ad Creative 创建 ====================

export interface CreateAdCreativeParams {
  accountId: string
  token: string
  name: string
  objectStorySpec: any
  degreesOfFreedomSpec?: any
  assetFeedSpec?: any // 用于动态素材
}

export const createAdCreative = async (params: CreateAdCreativeParams) => {
  const {
    accountId,
    token,
    name,
    objectStorySpec,
    degreesOfFreedomSpec,
    assetFeedSpec,
  } = params

  const requestParams: any = {
    access_token: token,
    name,
    object_story_spec: JSON.stringify(objectStorySpec),
  }

  if (degreesOfFreedomSpec) {
    requestParams.degrees_of_freedom_spec = JSON.stringify(degreesOfFreedomSpec)
  }
  if (assetFeedSpec) {
    requestParams.asset_feed_spec = JSON.stringify(assetFeedSpec)
  }

  try {
    logger.info(`[BulkCreate] Creating ad creative for account ${accountId}: ${name}`)
    const res = await facebookClient.post(`/act_${accountId}/adcreatives`, requestParams)
    logger.info(`[BulkCreate] Ad Creative created: ${res.id}`)
    return { success: true, id: res.id, data: res }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to create ad creative:`, error.response?.data || error.message)
    return {
      success: false,
      error: {
        code: error.response?.data?.error?.code || 'UNKNOWN',
        message: error.response?.data?.error?.message || error.message,
        details: error.response?.data,
      },
    }
  }
}

// ==================== Ad 创建 ====================

export interface CreateAdParams {
  accountId: string
  token: string
  adsetId: string
  creativeId: string
  name: string
  status: string
  trackingSpecs?: any
  urlTags?: string
}

export const createAd = async (params: CreateAdParams) => {
  const {
    accountId,
    token,
    adsetId,
    creativeId,
    name,
    status,
    trackingSpecs,
    urlTags,
  } = params

  const requestParams: any = {
    access_token: token,
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    name,
    status,
  }

  if (trackingSpecs) {
    requestParams.tracking_specs = JSON.stringify(trackingSpecs)
  }
  if (urlTags) {
    requestParams.url_tags = urlTags
  }

  try {
    logger.info(`[BulkCreate] Creating ad for adset ${adsetId}: ${name}`)
    const res = await facebookClient.post(`/act_${accountId}/ads`, requestParams)
    logger.info(`[BulkCreate] Ad created: ${res.id}`)
    return { success: true, id: res.id, data: res }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to create ad:`, error.response?.data || error.message)
    return {
      success: false,
      error: {
        code: error.response?.data?.error?.code || 'UNKNOWN',
        message: error.response?.data?.error?.message || error.message,
        details: error.response?.data,
      },
    }
  }
}

// ==================== 素材上传 ====================

export interface UploadImageParams {
  accountId: string
  token: string
  imageUrl: string
  name?: string
}

export const uploadImageFromUrl = async (params: UploadImageParams) => {
  const { accountId, token, imageUrl, name } = params

  const requestParams: any = {
    access_token: token,
    url: imageUrl,
  }
  if (name) {
    requestParams.name = name
  }

  try {
    logger.info(`[BulkCreate] Uploading image for account ${accountId}`)
    const res = await facebookClient.post(`/act_${accountId}/adimages`, requestParams)
    const images = res.images || {}
    const imageHash = Object.values(images)[0] as any
    logger.info(`[BulkCreate] Image uploaded, hash: ${imageHash?.hash}`)
    return { success: true, hash: imageHash?.hash, data: res }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to upload image:`, error.response?.data || error.message)
    return {
      success: false,
      error: {
        code: error.response?.data?.error?.code || 'UNKNOWN',
        message: error.response?.data?.error?.message || error.message,
        details: error.response?.data,
      },
    }
  }
}

export interface UploadVideoParams {
  accountId: string
  token: string
  videoUrl: string
  title?: string
  description?: string
}

export const uploadVideoFromUrl = async (params: UploadVideoParams) => {
  const { accountId, token, videoUrl, title, description } = params

  const requestParams: any = {
    access_token: token,
    file_url: videoUrl,
  }
  if (title) {
    requestParams.title = title
  }
  if (description) {
    requestParams.description = description
  }

  try {
    logger.info(`[BulkCreate] Uploading video for account ${accountId}`)
    const res = await facebookClient.post(`/act_${accountId}/advideos`, requestParams)
    logger.info(`[BulkCreate] Video uploaded, id: ${res.id}`)
    return { success: true, id: res.id, data: res }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to upload video:`, error.response?.data || error.message)
    return {
      success: false,
      error: {
        code: error.response?.data?.error?.code || 'UNKNOWN',
        message: error.response?.data?.error?.message || error.message,
        details: error.response?.data,
      },
    }
  }
}

// ==================== 搜索 API ====================

export interface SearchInterestsParams {
  token: string
  query: string
  type?: string
  limit?: number
}

export const searchTargetingInterests = async (params: SearchInterestsParams) => {
  const { token, query, type = 'adinterest', limit = 50 } = params

  try {
    const res = await facebookClient.get('/search', {
      access_token: token,
      type,
      q: query,
      limit,
    })
    return { success: true, data: res.data || [] }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to search interests:`, error.message)
    return { success: false, error: error.message, data: [] }
  }
}

export interface SearchLocationsParams {
  token: string
  query: string
  type?: string
  limit?: number
}

export const searchTargetingLocations = async (params: SearchLocationsParams) => {
  const { token, query, type = 'adgeolocation', limit = 50 } = params

  try {
    const res = await facebookClient.get('/search', {
      access_token: token,
      type,
      q: query,
      location_types: JSON.stringify(['country', 'region', 'city']),
      limit,
    })
    return { success: true, data: res.data || [] }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to search locations:`, error.message)
    return { success: false, error: error.message, data: [] }
  }
}

// ==================== 获取 Pages 和 Instagram ====================

export const getPages = async (accountId: string, token: string) => {
  try {
    const res = await facebookClient.get(`/act_${accountId}/promote_pages`, {
      access_token: token,
      fields: 'id,name,picture',
      limit: 100,
    })
    return { success: true, data: res.data || [] }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to get pages:`, error.message)
    return { success: false, error: error.message, data: [] }
  }
}

export const getInstagramAccounts = async (pageId: string, token: string) => {
  try {
    const res = await facebookClient.get(`/${pageId}/instagram_accounts`, {
      access_token: token,
      fields: 'id,username,profile_pic',
    })
    return { success: true, data: res.data || [] }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to get Instagram accounts:`, error.message)
    return { success: false, error: error.message, data: [] }
  }
}

// ==================== 获取 Pixels ====================

export const getPixels = async (accountId: string, token: string) => {
  try {
    const res = await facebookClient.get(`/act_${accountId}/adspixels`, {
      access_token: token,
      fields: 'id,name,code,last_fired_time',
      limit: 100,
    })
    return { success: true, data: res.data || [] }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to get pixels:`, error.message)
    return { success: false, error: error.message, data: [] }
  }
}

// ==================== 获取自定义转化事件 ====================

export const getCustomConversions = async (accountId: string, token: string) => {
  try {
    const res = await facebookClient.get(`/act_${accountId}/customconversions`, {
      access_token: token,
      fields: 'id,name,pixel,rule,creation_time',
      limit: 100,
    })
    return { success: true, data: res.data || [] }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to get custom conversions:`, error.message)
    return { success: false, error: error.message, data: [] }
  }
}

