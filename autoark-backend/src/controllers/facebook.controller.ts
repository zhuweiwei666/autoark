import { Request, Response, NextFunction } from 'express'
import * as facebookService from '../services/facebook.service'
import * as facebookAccountsService from '../services/facebook.accounts.service'
import * as facebookCampaignsService from '../services/facebook.campaigns.service'
import * as facebookCampaignsV2Service from '../services/facebook.campaigns.v2.service'
import * as facebookPermissionsService from '../services/facebook.permissions.service'
import * as facebookPurchaseCorrectionService from '../services/facebook.purchase.correction'
import { tokenPool } from '../services/facebook.token.pool'
import * as facebookCountriesService from '../services/facebook.countries.service'
import { getEffectiveAdAccounts } from '../services/facebook.sync.service'
import { getOrgFilter, getUserAccountIds } from '../middlewares/auth'
import { UserRole } from '../models/User'
import { FB_VERSIONED_URL } from '../config/facebook.config'
import { buildInsightsDateRequest, InsightsDateRangeError } from '../utils/insightsDateRange'
import Ad from '../models/Ad'
import Campaign from '../models/Campaign'
import Account from '../models/Account'
import FbToken from '../models/FbToken'
import { normalizeForApi, normalizeForStorage } from '../utils/accountId'
import {
  parseLimitedNumber,
  parsePagination,
  pickAllowedString,
  pickSafeQueryString,
  pickSafeRegexLiteral,
} from '../utils/pagination'
import logger from '../utils/logger'
import { writeAuditLog } from '../services/auditLog.service'
import { backfillFacebookOriginalImages } from '../services/facebookMaterialBackfill.service'

const FACEBOOK_LIST_MAX_LIMIT = 100
const FACEBOOK_DIAGNOSE_DEFAULT_LIMIT = 20
const FACEBOOK_DIAGNOSE_MAX_LIMIT = 100
const FACEBOOK_CAMPAIGN_ID_MAX_LENGTH = 160
const FACEBOOK_COUNTRY_MAX_LENGTH = 40
const FACEBOOK_CAMPAIGN_SORT_FIELDS = [
  'accountId',
  'accountName',
  'campaignId',
  'campaignName',
  'clicks',
  'cpc',
  'cpi',
  'cpm',
  'ctr',
  'createdAt',
  'impressions',
  'installs',
  'name',
  'objective',
  'purchase_roas',
  'purchase_value',
  'revenue',
  'roas',
  'spend',
  'status',
  'updatedAt',
]
const FACEBOOK_ACCOUNT_SORT_FIELDS = [
  'accountId',
  'clicks',
  'ctr',
  'impressions',
  'installs',
  'name',
  'periodSpend',
  'purchase_value',
  'roas',
  'spend',
  'status',
  'updatedAt',
]
const FACEBOOK_COUNTRY_SORT_FIELDS = [
  'campaigns',
  'clicks',
  'country',
  'countryName',
  'ctr',
  'impressions',
  'installs',
  'purchase_roas',
  'purchase_value',
  'roas',
  'spend',
]

const getListPagination = (
  req: Request,
  allowedSortFields: readonly string[],
  defaultSortBy: string,
) => {
  const { page, pageSize } = parsePagination(
    { page: req.query.page, limit: req.query.limit },
    { defaultPageSize: 20, maxPageSize: FACEBOOK_LIST_MAX_LIMIT },
  )
  return {
    page,
    limit: pageSize,
    sortBy: pickAllowedString(req.query.sortBy, allowedSortFields, defaultSortBy),
    sortOrder: (req.query.sortOrder as 'asc' | 'desc') === 'asc' ? 'asc' as const : 'desc' as const,
  }
}

const requireSuperAdmin = (req: Request, res: Response): boolean => {
  if (req.user?.role === UserRole.SUPER_ADMIN) return true
  res.status(403).json({ success: false, error: 'Forbidden' })
  return false
}

const ensureAccountAccess = async (req: Request, accountId: string): Promise<boolean> => {
  const accountIds = await getUserAccountIds(req)
  if (accountIds === null) return true
  const requestedAccountId = normalizeForStorage(accountId)
  return accountIds.some(id => normalizeForStorage(id) === requestedAccountId)
}

const accountIdVariants = (accountId: string): string[] => {
  const normalized = normalizeForStorage(accountId)
  const apiId = normalizeForApi(accountId)
  return Array.from(new Set([normalized, apiId].filter(Boolean)))
}

const accountAuthorizationError = (message: string) => Object.assign(new Error(message), { statusCode: 403 })

const sendFacebookDateRangeError = (res: Response, error: any): boolean => {
  if (error instanceof InsightsDateRangeError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    })
    return true
  }
  return false
}

const parseFacebookDateFilters = (req: Request) => {
  if (req.query.startDate === undefined && req.query.endDate === undefined) return {}

  const dateRequest = buildInsightsDateRequest({
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  })

  return {
    startDate: dateRequest.startDate,
    endDate: dateRequest.endDate,
  }
}

const parseRequiredFacebookDate = (value: any, fieldName: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  try {
    const dateRequest = buildInsightsDateRequest({ startDate: value, endDate: value })
    return dateRequest.startDate
  } catch (error) {
    if (error instanceof InsightsDateRangeError) {
      throw new InsightsDateRangeError(`${fieldName} must be a valid YYYY-MM-DD date`)
    }
    throw error
  }
}

const resolveAccountAccessToken = async (req: Request, accountId: string): Promise<string> => {
  const query: any = {
    channel: 'facebook',
    accountId: { $in: accountIdVariants(accountId) },
  }

  if (req.user?.role !== UserRole.SUPER_ADMIN) {
    const tokenQuery: any = { status: 'active' }
    if (req.user?.role === UserRole.ORG_ADMIN && req.user.organizationId) {
      tokenQuery.organizationId = req.user.organizationId
    } else {
      tokenQuery.userId = req.user?.userId
    }

    const tokens = await FbToken.find(tokenQuery).select('token').lean()
    const tokenValues = tokens.map((token: any) => token.token).filter(Boolean)
    if (tokenValues.length === 0) {
      throw accountAuthorizationError('未找到当前用户可用的 Facebook 授权')
    }

    query.token = { $in: tokenValues }
  }

  const account = await Account.findOne(query).select('token').lean()
  if (!account?.token) {
    throw accountAuthorizationError(`没有找到可访问账户 ${normalizeForStorage(accountId)} 的 Facebook 授权`)
  }

  return account.token
}

export const syncCampaigns = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    // 使用新的队列系统（V2）
    const useV2 = req.query.v2 === 'true' || process.env.USE_QUEUE_SYNC === 'true'
    
    if (useV2) {
      const accountIds = Array.isArray(req.body?.accountIds)
        ? req.body.accountIds
            .filter((id: unknown): id is string => typeof id === 'string')
            .map((id: string) => normalizeForStorage(id))
            .filter(Boolean)
            .slice(0, 100)
        : undefined
      const result = await facebookCampaignsV2Service.syncCampaignsFromAdAccountsV2({
        accountIds,
        limit: typeof req.body?.limit === 'number' ? req.body.limit : undefined,
      })
      res.json({
        success: true,
        message: 'Campaigns sync queued (using BullMQ)',
        data: result,
      })
    } else {
      // 旧版本（同步执行）
      const result = await facebookCampaignsService.syncCampaignsFromAdAccounts()
      res.json({
        success: true,
        message: 'Campaigns sync completed',
        data: result,
      })
    }
  } catch (error) {
    next(error)
  }
}

// 获取队列状态
export const getQueueStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const status = await facebookCampaignsV2Service.getQueueStatus()
    res.json({
      success: true,
      data: status,
    })
  } catch (error) {
    next(error)
  }
}

export const recoverQueue = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!requireSuperAdmin(req, res)) return

  const dryRun = req.body?.dryRun !== false
  try {
    const result = await facebookCampaignsV2Service.recoverFacebookAccountQueue({
      dryRun,
      confirmation: typeof req.body?.confirmation === 'string'
        ? req.body.confirmation
        : undefined,
      maxJobs: typeof req.body?.maxJobs === 'number'
        ? req.body.maxJobs
        : undefined,
    })

    await writeAuditLog(req, {
      category: 'facebook',
      action: dryRun ? 'facebook.queue.recover.preview' : 'facebook.queue.recover.apply',
      status: 'success',
      targetType: 'bullmq_queue',
      targetId: 'facebook.account.sync',
      summary: dryRun
        ? `预览 Facebook 账户队列恢复：${result.candidates} 个候选任务`
        : `执行 Facebook 账户队列恢复：移除 ${result.removed} 个任务`,
      metadata: result,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    await writeAuditLog(req, {
      category: 'facebook',
      action: dryRun ? 'facebook.queue.recover.preview' : 'facebook.queue.recover.apply',
      status: 'failed',
      targetType: 'bullmq_queue',
      targetId: 'facebook.account.sync',
      summary: 'Facebook 账户队列恢复失败',
      reason: error.message,
    })
    next(error)
  }
}

export const retryFailedQueueJobs = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!requireSuperAdmin(req, res)) return

  const dryRun = req.body?.dryRun !== false
  const queue = req.body?.queue
  try {
    const result = await facebookCampaignsV2Service.retryFacebookQueueFailures({
      queue,
      dryRun,
      confirmation: typeof req.body?.confirmation === 'string'
        ? req.body.confirmation
        : undefined,
      maxJobs: typeof req.body?.maxJobs === 'number'
        ? req.body.maxJobs
        : undefined,
    })

    await writeAuditLog(req, {
      category: 'facebook',
      action: dryRun ? 'facebook.queue.retry_failed.preview' : 'facebook.queue.retry_failed.apply',
      status: 'success',
      targetType: 'bullmq_queue',
      targetId: `facebook.${result.queue}.sync`,
      summary: dryRun
        ? `预览 Facebook ${result.queue} 队列失败任务重试：${result.candidates} 个候选任务`
        : `执行 Facebook ${result.queue} 队列失败任务重试：重试 ${result.retried} 个任务`,
      metadata: result,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    await writeAuditLog(req, {
      category: 'facebook',
      action: dryRun ? 'facebook.queue.retry_failed.preview' : 'facebook.queue.retry_failed.apply',
      status: 'failed',
      targetType: 'bullmq_queue',
      targetId: `facebook.${String(queue || 'unknown')}.sync`,
      summary: 'Facebook 队列失败任务重试失败',
      reason: error.message,
    })
    next(error)
  }
}

export const backfillOriginalImages = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!requireSuperAdmin(req, res)) return

  const dryRun = req.body?.dryRun !== false
  try {
    const result = await backfillFacebookOriginalImages({
      dryRun,
      confirmation: typeof req.body?.confirmation === 'string'
        ? req.body.confirmation
        : undefined,
      maxJobs: typeof req.body?.maxJobs === 'number'
        ? req.body.maxJobs
        : undefined,
    })

    await writeAuditLog(req, {
      category: 'facebook',
      action: dryRun
        ? 'facebook.material.original_image_backfill.preview'
        : 'facebook.material.original_image_backfill.apply',
      status: 'success',
      targetType: 'bullmq_queue',
      targetId: 'facebook.material.sync',
      summary: dryRun
        ? `预览 Facebook 原图回填：${result.eligible} 个可执行任务`
        : `执行 Facebook 原图回填：入队 ${result.queued} 个任务`,
      metadata: result,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    await writeAuditLog(req, {
      category: 'facebook',
      action: dryRun
        ? 'facebook.material.original_image_backfill.preview'
        : 'facebook.material.original_image_backfill.apply',
      status: 'failed',
      targetType: 'bullmq_queue',
      targetId: 'facebook.material.sync',
      summary: 'Facebook 原图回填失败',
      reason: error.message,
    })
    next(error)
  }
}

// 诊断 Token 权限
export const diagnoseTokens = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const { tokenId } = req.query
    
    if (tokenId) {
      // 诊断单个 token
      const result = await facebookPermissionsService.diagnoseToken(tokenId as string)
      res.json({
        success: true,
        data: result,
      })
    } else {
      // 诊断所有 token
      const limit = parseLimitedNumber(req.query.limit, FACEBOOK_DIAGNOSE_DEFAULT_LIMIT, FACEBOOK_DIAGNOSE_MAX_LIMIT)
      const diagnosis = await facebookPermissionsService.diagnoseAllTokens({ limit })
      res.json({
        success: true,
        data: diagnosis.results,
        meta: diagnosis.meta,
      })
    }
  } catch (error) {
    next(error)
  }
}

// 获取 Token Pool 状态
export const getTokenPoolStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const status = tokenPool.getTokenStatus()
    res.json({
      success: true,
      data: status,
    })
  } catch (error) {
    next(error)
  }
}

// 获取 Purchase 值信息（用于前端 Tooltip）
export const getPurchaseValueInfo = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const campaignId = pickSafeQueryString(req.query.campaignId, FACEBOOK_CAMPAIGN_ID_MAX_LENGTH)
    const date = parseRequiredFacebookDate(req.query.date, 'date')
    const country = pickSafeQueryString(req.query.country, FACEBOOK_COUNTRY_MAX_LENGTH)
    
    if (!campaignId || !date) {
      return res.status(400).json({
        success: false,
        message: 'campaignId and date are required',
      })
    }

    const campaign = await Campaign.findOne({ channel: 'facebook', campaignId }).select('accountId').lean()
    if (!campaign?.accountId) {
      return res.status(404).json({ success: false, error: 'Campaign not found' })
    }
    if (!(await ensureAccountAccess(req, campaign.accountId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }

    const info = await facebookPurchaseCorrectionService.getPurchaseValueInfo(
      campaignId,
      date,
      country
    )

    res.json({
      success: true,
      data: info,
    })
  } catch (error) {
    if (sendFacebookDateRangeError(res, error)) return
    next(error)
  }
}

export const getCampaignsList = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 确保设置正确的 Content-Type
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    
    const pagination = getListPagination(req, FACEBOOK_CAMPAIGN_SORT_FIELDS, 'spend')
    const dateFilters = parseFacebookDateFilters(req)
    const filters: any = {
        name: pickSafeRegexLiteral(req.query.name),
        accountId: pickSafeQueryString(req.query.accountId),
        status: pickSafeQueryString(req.query.status),
        objective: pickSafeQueryString(req.query.objective),
        ...dateFilters,
    }

    // 用户隔离：根据用户绑定的 Token 过滤账户
    const userAccountIds = await getUserAccountIds(req)
    if (userAccountIds !== null) {
      filters.accountIds = userAccountIds
    }

    const result = await facebookCampaignsService.getCampaigns(filters, pagination)
    res.json({
      success: true,
      ...result
    })
  } catch (error) {
    if (sendFacebookDateRangeError(res, error)) return
    next(error)
  }
}

export const syncAccounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const result = await facebookAccountsService.syncAccountsFromTokens()
    res.json({
      success: true,
      message: 'Accounts sync completed',
      data: result,
    })
  } catch (error) {
    next(error)
  }
}

export const getAccountsList = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const pagination = getListPagination(req, FACEBOOK_ACCOUNT_SORT_FIELDS, 'periodSpend')
    const dateFilters = parseFacebookDateFilters(req)
    const filters: any = {
        optimizer: pickSafeRegexLiteral(req.query.optimizer),
        status: pickSafeQueryString(req.query.status),
        accountId: pickSafeRegexLiteral(req.query.accountId),
        name: pickSafeRegexLiteral(req.query.name),
        ...dateFilters,
    }

    // 用户隔离：根据用户绑定的 Token 过滤账户
    const userAccountIds = await getUserAccountIds(req)
    if (userAccountIds !== null) {
      // 非超级管理员，限制只能看到自己关联的账户
      filters.accountIds = userAccountIds
    }
    
    // 组织隔离（兼容旧逻辑）
    const organizationId = req.user?.role === UserRole.SUPER_ADMIN ? undefined : req.user?.organizationId
    const result = await facebookAccountsService.getAccounts(filters, pagination, organizationId)
    res.json({
      success: true,
      ...result
    })
  } catch (error) {
    if (sendFacebookDateRangeError(res, error)) return
    next(error)
  }
}

export const getCountriesList = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 确保设置正确的 Content-Type
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    
    const pagination = getListPagination(req, FACEBOOK_COUNTRY_SORT_FIELDS, 'spend')
    const dateFilters = parseFacebookDateFilters(req)
    const filters = {
        name: pickSafeRegexLiteral(req.query.name),
        accountId: pickSafeQueryString(req.query.accountId),
        status: pickSafeQueryString(req.query.status),
        objective: pickSafeQueryString(req.query.objective),
        ...dateFilters,
    }

    const accountIds = await getUserAccountIds(req)
    const tokenFilter: any = {}
    if (req.user?.role === UserRole.ORG_ADMIN && req.user.organizationId) {
      tokenFilter.organizationId = req.user.organizationId
    } else if (req.user?.role !== UserRole.SUPER_ADMIN) {
      tokenFilter.userId = req.user?.userId
    }

    const result = await facebookCountriesService.getCountries(
      filters,
      pagination,
      accountIds === null
        ? {}
        : {
            accountIds,
            tokenFilter,
            allowCacheFallback: false,
            allowCacheWrite: false,
          },
    )
    res.json({
      success: true,
      ...result
    })
  } catch (error) {
    if (sendFacebookDateRangeError(res, error)) return
    next(error)
  }
}

export const getCampaigns = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    if (!(await ensureAccountAccess(req, id))) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }
    const token = await resolveAccountAccessToken(req, id)
    const data = await facebookService.getCampaigns(id, token)
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export const getAdSets = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    if (!(await ensureAccountAccess(req, id))) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }
    const token = await resolveAccountAccessToken(req, id)
    const data = await facebookService.getAdSets(id, token)
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export const getAds = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    if (!(await ensureAccountAccess(req, id))) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }
    const token = await resolveAccountAccessToken(req, id)
    const data = await facebookService.getAds(id, token)
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export const getInsightsDaily = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    if (!(await ensureAccountAccess(req, id))) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }
    const token = await resolveAccountAccessToken(req, id)
    const data = await facebookService.getInsightsDaily(id, undefined, token)
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export const getAccounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const accounts = await getEffectiveAdAccounts()
    const accountIds = await getUserAccountIds(req)
    const filteredAccounts = accountIds === null
      ? accounts
      : accounts.filter((account: any) => accountIds.includes(account.accountId) || accountIds.includes(String(account.accountId || '').replace(/^act_/, '')))
    res.json({
      success: true,
      accounts: filteredAccounts,
    })
  } catch (error) {
    next(error)
  }
}

// 刷新指定 Campaign 下所有广告的状态
async function refreshCampaignAdsStatus(campaignId: string, accountId: string, token: string) {
  // 获取该 Campaign 下的所有广告
  const ads = await Ad.find({ channel: 'facebook', campaignId, accountId }).select('adId').lean()
  if (ads.length === 0) return
  
  const adIds = ads.map((ad: any) => ad.adId)
  
  // 批量查询广告状态（每次最多50个）
  const batchSize = 50
  for (let i = 0; i < adIds.length; i += batchSize) {
    const batch = adIds.slice(i, i + batchSize)
    const idsParam = batch.join(',')
    
    try {
      const response = await fetch(
        `${FB_VERSIONED_URL}/?ids=${idsParam}&fields=effective_status&access_token=${token}`
      )
      const result = await response.json()
      
      // 更新每个广告的状态
      for (const adId of batch) {
        if (result[adId] && result[adId].effective_status) {
          await Ad.findOneAndUpdate(
            { channel: 'facebook', adId, accountId },
            { effectiveStatus: result[adId].effective_status, updatedAt: new Date() }
          )
        }
      }
    } catch (err: any) {
      logger.error('[RefreshAdsStatus] Batch failed:', err.message)
    }
  }
  
  logger.info(`[RefreshAdsStatus] Refreshed ${adIds.length} ads for campaign ${campaignId}`)
}

// 更新 Campaign 状态 (ACTIVE/PAUSED)
export const updateCampaignStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const { campaignId } = req.params
    const { status } = req.body
    
    if (!campaignId) {
      return res.status(400).json({ success: false, error: 'Campaign ID is required' })
    }
    
    if (!status || !['ACTIVE', 'PAUSED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be ACTIVE or PAUSED' })
    }
    
    const campaign = await Campaign.findOne({ channel: 'facebook', campaignId }).select('accountId').lean()
    if (!campaign?.accountId) {
      return res.status(404).json({ success: false, error: 'Campaign not found' })
    }

    const token = await resolveAccountAccessToken(req, campaign.accountId)
    
    // 调用 Facebook API 更新状态
    const response = await fetch(`${FB_VERSIONED_URL}/${campaignId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        status: status,
      }),
    })
    
    const result = await response.json()
    
    if (result.error) {
      return res.status(400).json({ 
        success: false, 
        error: result.error.message || 'Failed to update campaign status' 
      })
    }
    
    // 更新本地数据库
    await Campaign.findOneAndUpdate(
      { channel: 'facebook', campaignId, accountId: campaign.accountId },
      { status, updatedAt: new Date() }
    )
    
    // 异步刷新该 Campaign 下所有广告的状态
    refreshCampaignAdsStatus(campaignId, campaign.accountId, token).catch(err => {
      logger.error('[Campaign Status] Failed to refresh ads status:', err.message)
    })
    
    res.json({ 
      success: true, 
      message: `Campaign status updated to ${status}`,
      data: { campaignId, status }
    })
  } catch (error: any) {
    next(error)
  }
}
