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
    // Facebook API 要求参数为 JSON 字符串格式
    // 无特殊类别时传空数组 "[]"
    special_ad_categories: JSON.stringify(specialAdCategories.length > 0 ? specialAdCategories : []),
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
    logger.info(`[BulkCreate] Campaign params: ${JSON.stringify(requestParams, null, 2)}`)
    const res = await facebookClient.post(`/act_${accountId}/campaigns`, requestParams)
    logger.info(`[BulkCreate] Campaign created: ${res.id}`)
    return { success: true, id: res.id, data: res }
  } catch (error: any) {
    // FacebookApiError 有特殊结构: { response, code, subcode, userMessage }
    const fbResponse = error.response || {}
    const fbError = fbResponse.error || {}
    
    logger.error(`[BulkCreate] Failed to create campaign - Full error:`, JSON.stringify({
      message: error.message,
      code: error.code || fbError.code,
      subcode: error.subcode || fbError.error_subcode,
      userMessage: error.userMessage || fbError.error_user_msg || fbError.error_user_title,
      fbResponse: fbResponse,
      rawError: String(error),
    }, null, 2))
    
    return {
      success: false,
      error: {
        code: error.code || fbError.code || 'UNKNOWN',
        subcode: error.subcode || fbError.error_subcode,
        message: fbError.message || error.message,
        userTitle: fbError.error_user_title,
        userMsg: error.userMessage || fbError.error_user_msg,
        details: fbResponse,
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
  dsa_beneficiary?: string  // DSA 受益方（欧盟合规）
  dsa_payor?: string        // DSA 付款方（欧盟合规）
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
    dsa_beneficiary,
    dsa_payor,
  } = params

  // 处理 targeting：确保国家代码大写，并添加必要的 targeting_automation 字段
  const processedTargeting = { ...targeting }
  
  // 确保国家代码大写
  if (processedTargeting.geo_locations?.countries) {
    processedTargeting.geo_locations.countries = processedTargeting.geo_locations.countries.map(
      (c: string) => c.toUpperCase()
    )
  }
  
  // Facebook API 要求：必须设置 targeting_automation.advantage_audience
  if (!processedTargeting.targeting_automation) {
    processedTargeting.targeting_automation = { advantage_audience: 0 }
  }

  const requestParams: any = {
    access_token: token,
    campaign_id: campaignId,
    name,
    status,
    targeting: JSON.stringify(processedTargeting),
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
  // DSA 合规字段（欧盟数字服务法案）
  if (dsa_beneficiary) {
    requestParams.dsa_beneficiary = dsa_beneficiary
  }
  if (dsa_payor) {
    requestParams.dsa_payor = dsa_payor
  }

  try {
    logger.info(`[BulkCreate] Creating adset for campaign ${campaignId}: ${name}`)
    logger.info(`[BulkCreate] AdSet params: ${JSON.stringify(requestParams, null, 2)}`)
    const res = await facebookClient.post(`/act_${accountId}/adsets`, requestParams)
    logger.info(`[BulkCreate] AdSet created: ${res.id}`)
    return { success: true, id: res.id, data: res }
  } catch (error: any) {
    const errorData = error.response?.data?.error || error.response?.data || error.message
    logger.error(`[BulkCreate] Failed to create adset - Full error:`, JSON.stringify(errorData, null, 2))
    logger.error(`[BulkCreate] AdSet failed params: ${JSON.stringify(requestParams, null, 2)}`)
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
    logger.info(`[BulkCreate] Creative params: ${JSON.stringify(requestParams, null, 2)}`)
    const res = await facebookClient.post(`/act_${accountId}/adcreatives`, requestParams)
    logger.info(`[BulkCreate] Ad Creative created: ${res.id}`)
    return { success: true, id: res.id, data: res }
  } catch (error: any) {
    // 从 FacebookApiError 获取详细信息
    const fbError = error.response?.error || {}
    const responseData = error.response || {}
    logger.error(`[BulkCreate] Failed to create ad creative - Full error:`)
    logger.error(`[BulkCreate] Error code: ${error.code || fbError.code}`)
    logger.error(`[BulkCreate] Error message: ${fbError.message || error.message}`)
    logger.error(`[BulkCreate] Error type: ${fbError.type}`)
    logger.error(`[BulkCreate] Error subcode: ${error.subcode || fbError.error_subcode}`)
    logger.error(`[BulkCreate] Error user_msg: ${error.userMessage || fbError.error_user_msg || fbError.error_user_title}`)
    logger.error(`[BulkCreate] Full response: ${JSON.stringify(responseData, null, 2)}`)
    logger.error(`[BulkCreate] Creative failed params: ${JSON.stringify(requestParams, null, 2)}`)
    return {
      success: false,
      error: {
        code: error.code || fbError.code || 'UNKNOWN',
        message: fbError.message || error.message,
        details: responseData,
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
    
    // 获取视频缩略图
    let thumbnailUrl: string | undefined
    try {
      // 等待一小段时间让 Facebook 处理视频
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      const videoDetails = await facebookClient.get(`/${res.id}`, {
        access_token: token,
        fields: 'thumbnails,picture',
      })
      
      // 优先使用 picture，其次使用 thumbnails 中的第一个
      if (videoDetails.picture) {
        thumbnailUrl = videoDetails.picture
      } else if (videoDetails.thumbnails?.data?.[0]?.uri) {
        thumbnailUrl = videoDetails.thumbnails.data[0].uri
      }
      logger.info(`[BulkCreate] Video thumbnail: ${thumbnailUrl}`)
    } catch (thumbError: any) {
      logger.warn(`[BulkCreate] Failed to get video thumbnail: ${thumbError.message}`)
    }
    
    return { success: true, id: res.id, thumbnailUrl, data: res }
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
    // 1. 先尝试从广告账户获取 promote_pages
    let pages: any[] = []
    try {
      const promoteRes = await facebookClient.get(`/act_${accountId}/promote_pages`, {
        access_token: token,
        fields: 'id,name,picture',
        limit: 100,
      })
      pages = promoteRes.data || []
    } catch (e: any) {
      logger.warn(`[BulkCreate] Failed to get promote_pages for ${accountId}: ${e.message}`)
    }
    
    // 2. 如果没有 promote_pages，获取用户有广告权限的所有主页
    if (pages.length === 0) {
      logger.info(`[BulkCreate] No promote_pages for ${accountId}, falling back to user pages`)
      const userPagesRes = await facebookClient.get('/me/accounts', {
        access_token: token,
        fields: 'id,name,picture,tasks',
        limit: 100,
      })
      // 只返回有 ADVERTISE 权限的主页
      pages = (userPagesRes.data || []).filter((page: any) => 
        page.tasks && page.tasks.includes('ADVERTISE')
      )
      logger.info(`[BulkCreate] Found ${pages.length} user pages with ADVERTISE permission`)
    }
    
    return { success: true, data: pages }
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

// ==================== 更新 Campaign ====================

export interface UpdateCampaignParams {
  campaignId: string
  token: string
  name?: string
  status?: string
  dailyBudget?: number
  lifetimeBudget?: number
  bidStrategy?: string
}

export const updateCampaign = async (params: UpdateCampaignParams) => {
  const { campaignId, token, ...updates } = params

  const requestParams: any = {
    access_token: token,
  }

  if (updates.name) requestParams.name = updates.name
  if (updates.status) requestParams.status = updates.status
  if (updates.dailyBudget) requestParams.daily_budget = Math.round(updates.dailyBudget * 100)
  if (updates.lifetimeBudget) requestParams.lifetime_budget = Math.round(updates.lifetimeBudget * 100)
  if (updates.bidStrategy) requestParams.bid_strategy = updates.bidStrategy

  try {
    const res = await facebookClient.post(`/${campaignId}`, requestParams)
    logger.info(`[BulkCreate] Campaign updated: ${campaignId}`)
    return { success: true, id: campaignId }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to update campaign ${campaignId}:`, error.message)
    return { success: false, error: { message: error.message } }
  }
}

// ==================== 更新 AdSet ====================

export interface UpdateAdSetParams {
  adsetId: string
  token: string
  name?: string
  status?: string
  dailyBudget?: number
  lifetimeBudget?: number
  bidAmount?: number
  targeting?: any
}

export const updateAdSet = async (params: UpdateAdSetParams) => {
  const { adsetId, token, ...updates } = params

  const requestParams: any = {
    access_token: token,
  }

  if (updates.name) requestParams.name = updates.name
  if (updates.status) requestParams.status = updates.status
  if (updates.dailyBudget) requestParams.daily_budget = Math.round(updates.dailyBudget * 100)
  if (updates.lifetimeBudget) requestParams.lifetime_budget = Math.round(updates.lifetimeBudget * 100)
  if (updates.bidAmount) requestParams.bid_amount = Math.round(updates.bidAmount * 100)
  if (updates.targeting) requestParams.targeting = JSON.stringify(updates.targeting)

  try {
    const res = await facebookClient.post(`/${adsetId}`, requestParams)
    logger.info(`[BulkCreate] AdSet updated: ${adsetId}`)
    return { success: true, id: adsetId }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to update adset ${adsetId}:`, error.message)
    return { success: false, error: { message: error.message } }
  }
}

// ==================== 更新 Ad ====================

export interface UpdateAdParams {
  adId: string
  token: string
  name?: string
  status?: string
}

export const updateAd = async (params: UpdateAdParams) => {
  const { adId, token, ...updates } = params

  const requestParams: any = {
    access_token: token,
  }

  if (updates.name) requestParams.name = updates.name
  if (updates.status) requestParams.status = updates.status

  try {
    const res = await facebookClient.post(`/${adId}`, requestParams)
    logger.info(`[BulkCreate] Ad updated: ${adId}`)
    return { success: true, id: adId }
  } catch (error: any) {
    logger.error(`[BulkCreate] Failed to update ad ${adId}:`, error.message)
    return { success: false, error: { message: error.message } }
  }
}
