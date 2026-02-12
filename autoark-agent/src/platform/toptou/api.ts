/**
 * TopTou API - 广告数据查询和操作
 */
import { toptouClient } from './client'

// ==================== 读取 ====================

/** 获取基础信息（公司、角色等）*/
export async function getBaseInfo() {
  return toptouClient.get('/baseinfo/get')
}

/** 获取广告系列列表 */
export async function getCampaignList(params: { pageSize?: number; pageNum?: number } = {}) {
  return toptouClient.post('/fb/list/campaign/campaign_list', {
    pageSize: params.pageSize || 50,
    pageNum: params.pageNum || 1,
  })
}

/** 获取广告系列详情 */
export async function getCampaignDetails(campaignId: string) {
  return toptouClient.get('/facebook/data/getCampaignDetails', { campaignId })
}

/** 获取广告组列表 */
export async function getAdSetsByCampaign(campaignId: string) {
  return toptouClient.get('/facebook/data/getAdLevelInfoByCampaignId', { campaignId })
}

/** 获取广告详情 */
export async function getAdDetails(adId: string) {
  return toptouClient.get('/facebook/data/getAdDetails', { adId })
}

/** 获取广告组数量 */
export async function getAdSetCount(campaignId: string) {
  return toptouClient.get('/fb/list/adset/count/get', { campaignId })
}

/** 获取广告数量 */
export async function getAdCount(adsetId: string) {
  return toptouClient.get('/fb/list/ad/count/get', { adsetId })
}

/** 获取 Facebook 媒体用户账户列表 */
export async function getMediaUserAccounts() {
  return toptouClient.get('/facebook/mediaUser/account/list')
}

// ==================== 写操作（参数格式待确认）====================

// ==================== 写操作 ====================
// TopTou API 的 level 参数必须是数字：1=campaign, 2=adset, 3=ad

const LEVEL_MAP: Record<string, number> = { campaign: 1, adset: 2, ad: 3 }

/** 更新广告系列/广告组/广告状态（暂停/恢复） */
export async function updateStatus(params: {
  level: 'campaign' | 'adset' | 'ad'
  list: Array<{ id: string; accountId: string; status: 'ACTIVE' | 'PAUSED' }>
}) {
  return toptouClient.post('/fb/list/status', {
    level: LEVEL_MAP[params.level] || 1,
    list: params.list,
  })
}

/** 更新预算/名称（注意：此接口参数格式可能需要更新） */
export async function updateNameOrBudget(params: {
  level: 'campaign' | 'adset'
  id: string
  accountId: string
  daily_budget?: number
  name?: string
}) {
  return toptouClient.post('/facebook/editor/name-or-budget', {
    ...params,
    level: LEVEL_MAP[params.level] || 1,
  })
}

/** 更新广告系列 */
export async function updateCampaign(params: any) {
  return toptouClient.post('/facebook/data/updateCampaign', params)
}

/** 更新广告组 */
export async function updateAdSet(params: any) {
  return toptouClient.post('/facebook/data/updateAdset', params)
}

/** 刷新广告数据 */
export async function refreshData(params: { accountId: string }) {
  return toptouClient.post('/facebook/data/refresh', params)
}
