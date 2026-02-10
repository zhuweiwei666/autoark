/**
 * Facebook Write APIs - 创建/更新/暂停广告实体
 */
import { fbClient } from './client'
import { log } from '../logger'

// ==================== Campaign ====================

export async function createCampaign(p: {
  accountId: string; token: string; name: string; objective: string; status: string
  dailyBudget?: number; bidStrategy?: string; specialAdCategories?: string[]
}) {
  const params: any = {
    access_token: p.token, name: p.name, objective: p.objective, status: p.status,
    buying_type: 'AUCTION',
    special_ad_categories: JSON.stringify(p.specialAdCategories || []),
  }
  if (p.dailyBudget) params.daily_budget = Math.round(p.dailyBudget * 100)
  if (p.bidStrategy) params.bid_strategy = p.bidStrategy
  try {
    const res = await fbClient.post(`/act_${p.accountId}/campaigns`, params)
    log.info(`[FB] Campaign created: ${res.id}`)
    return { success: true, id: res.id }
  } catch (e: any) {
    log.error(`[FB] Create campaign failed: ${e.message}`)
    return { success: false, error: e.message }
  }
}

// ==================== AdSet ====================

export async function createAdSet(p: {
  accountId: string; token: string; campaignId: string; name: string; status: string
  countries: string[]; optimizationGoal: string; billingEvent: string
  dailyBudget?: number; pixelId?: string; customEventType?: string
}) {
  const targeting: any = {
    geo_locations: { countries: p.countries.map(c => c.toUpperCase()) },
    targeting_automation: { advantage_audience: 0 },
  }
  const params: any = {
    access_token: p.token, campaign_id: p.campaignId, name: p.name, status: p.status,
    targeting: JSON.stringify(targeting),
    optimization_goal: p.optimizationGoal, billing_event: p.billingEvent,
  }
  if (p.dailyBudget) params.daily_budget = Math.round(p.dailyBudget * 100)
  if (p.pixelId) {
    const obj: any = { pixel_id: p.pixelId }
    if (p.customEventType) obj.custom_event_type = p.customEventType
    params.promoted_object = JSON.stringify(obj)
  }
  try {
    const res = await fbClient.post(`/act_${p.accountId}/adsets`, params)
    log.info(`[FB] AdSet created: ${res.id}`)
    return { success: true, id: res.id }
  } catch (e: any) {
    log.error(`[FB] Create adset failed: ${e.message}`)
    return { success: false, error: e.message }
  }
}

// ==================== Ad Creative ====================

export async function createAdCreative(p: {
  accountId: string; token: string; name: string; objectStorySpec: any
}) {
  try {
    const res = await fbClient.post(`/act_${p.accountId}/adcreatives`, {
      access_token: p.token, name: p.name,
      object_story_spec: JSON.stringify(p.objectStorySpec),
    })
    log.info(`[FB] Creative created: ${res.id}`)
    return { success: true, id: res.id }
  } catch (e: any) {
    log.error(`[FB] Create creative failed: ${e.message}`)
    return { success: false, error: e.message }
  }
}

// ==================== Ad ====================

export async function createAd(p: {
  accountId: string; token: string; adsetId: string; creativeId: string; name: string; status: string
}) {
  try {
    const res = await fbClient.post(`/act_${p.accountId}/ads`, {
      access_token: p.token, adset_id: p.adsetId,
      creative: JSON.stringify({ creative_id: p.creativeId }),
      name: p.name, status: p.status,
    })
    log.info(`[FB] Ad created: ${res.id}`)
    return { success: true, id: res.id }
  } catch (e: any) {
    log.error(`[FB] Create ad failed: ${e.message}`)
    return { success: false, error: e.message }
  }
}

// ==================== 素材上传 ====================

export async function uploadImage(accountId: string, token: string, imageUrl: string) {
  try {
    const res = await fbClient.post(`/act_${accountId}/adimages`, { access_token: token, url: imageUrl })
    const hash = Object.values(res.images || {})[0] as any
    return { success: true, hash: hash?.hash }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function uploadVideo(accountId: string, token: string, videoUrl: string, title?: string) {
  try {
    const params: any = { access_token: token, file_url: videoUrl }
    if (title) params.title = title
    const res = await fbClient.post(`/act_${accountId}/advideos`, params)
    return { success: true, id: res.id }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ==================== 更新 ====================

export async function updateCampaign(campaignId: string, token: string, updates: {
  status?: string; dailyBudget?: number; name?: string
}) {
  const params: any = { access_token: token }
  if (updates.status) params.status = updates.status
  if (updates.dailyBudget) params.daily_budget = Math.round(updates.dailyBudget * 100)
  if (updates.name) params.name = updates.name
  try {
    await fbClient.post(`/${campaignId}`, params)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function updateAdSet(adsetId: string, token: string, updates: {
  status?: string; dailyBudget?: number; name?: string
}) {
  const params: any = { access_token: token }
  if (updates.status) params.status = updates.status
  if (updates.dailyBudget) params.daily_budget = Math.round(updates.dailyBudget * 100)
  if (updates.name) params.name = updates.name
  try {
    await fbClient.post(`/${adsetId}`, params)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function updateAd(adId: string, token: string, updates: { status?: string; name?: string }) {
  const params: any = { access_token: token }
  if (updates.status) params.status = updates.status
  if (updates.name) params.name = updates.name
  try {
    await fbClient.post(`/${adId}`, params)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
