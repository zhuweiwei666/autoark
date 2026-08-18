import { Request, Response, NextFunction } from 'express'
import * as facebookService from '../services/facebook.service'
import * as facebookAccountsService from '../services/facebook.accounts.service'
import { runPendingAccountInsightsBackfill } from '../services/accountInsightsBackfill.service'
import { runPendingTokenInsightsBackfill } from '../services/tokenInsightsBackfill.service'
import * as facebookCampaignsService from '../services/facebook.campaigns.service'
import * as facebookCampaignsV2Service from '../services/facebook.campaigns.v2.service'
import * as facebookPermissionsService from '../services/facebook.permissions.service'
import * as facebookPurchaseCorrectionService from '../services/facebook.purchase.correction'
import { tokenPool } from '../services/facebook.token.pool'
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
  pickSafeQueryString,
} from '../utils/pagination'
import logger from '../utils/logger'
import { writeAuditLog } from '../services/auditLog.service'
import { backfillFacebookOriginalImages } from '../services/facebookMaterialBackfill.service'
import { backfillFacebookAccountMaterialsPage } from '../services/facebookAccountMaterialBackfill.service'
import { deduplicateFacebookMaterials } from '../services/facebookMaterialDeduplication.service'
import {
  resolveAccountOperationalAuthorization,
  resolvePublishingCredential,
} from '../services/metaBusinessCredential.service'

const FACEBOOK_DIAGNOSE_DEFAULT_LIMIT = 20
const FACEBOOK_DIAGNOSE_MAX_LIMIT = 100
const FACEBOOK_CAMPAIGN_ID_MAX_LENGTH = 160
const FACEBOOK_COUNTRY_MAX_LENGTH = 40

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

const redirectLegacyInsightsList = (
  req: Request,
  res: Response,
  resource: 'accounts' | 'campaigns' | 'countries',
) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') {
      query.append(key, value)
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') query.append(key, item)
      }
    }
  }

  // The snapshot country endpoint uses `order`; the legacy endpoint used
  // `sortOrder`. Preserve the old contract while routing it to MongoDB.
  if (resource === 'countries' && !query.has('order') && query.has('sortOrder')) {
    query.set('order', query.get('sortOrder') || 'desc')
  }

  const successor = `/api/summary/${resource}`
  const location = query.size > 0 ? `${successor}?${query.toString()}` : successor
  res.setHeader('Deprecation', 'true')
  res.setHeader('Link', `<${successor}>; rel="successor-version"`)
  return res.redirect(307, location)
}

const resolveAccountAccessToken = async (req: Request, accountId: string): Promise<string> => {
  const accountQuery: any = {
    channel: 'facebook',
    accountId: { $in: accountIdVariants(accountId) },
  }

  if (!(await ensureAccountAccess(req, accountId))) {
    throw accountAuthorizationError(`没有权限访问账户 ${normalizeForStorage(accountId)}`)
  }

  const account: any = await Account.findOne(accountQuery)
    .select('token organizationId')
    .lean()
  if (!account) {
    throw accountAuthorizationError(`没有找到可访问账户 ${normalizeForStorage(accountId)} 的 Facebook 授权`)
  }

  const organizationId = req.user?.organizationId || account.organizationId
  if (
    req.user?.role !== UserRole.SUPER_ADMIN
    && req.user?.organizationId
    && account.organizationId
    && String(req.user.organizationId) !== String(account.organizationId)
  ) {
    throw accountAuthorizationError(`没有权限访问账户 ${normalizeForStorage(accountId)}`)
  }

  const systemCredential = await resolvePublishingCredential({
    organizationId,
    adAccountIds: [normalizeForStorage(accountId)],
  })
  if (systemCredential) {
    return systemCredential.token
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

    const scopedAccount: any = await Account.findOne({
      ...accountQuery,
      token: { $in: tokenValues },
    }).select('token').lean()
    if (!scopedAccount?.token) {
      throw accountAuthorizationError(`没有找到可访问账户 ${normalizeForStorage(accountId)} 的 Facebook 授权`)
    }
    return scopedAccount.token
  }

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

export const backfillAccountMaterials = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!requireSuperAdmin(req, res)) return

  const confirmation = req.body?.confirmation
  if (confirmation !== 'BACKFILL_FACEBOOK_ACCOUNT_MATERIALS') {
    res.status(400).json({
      success: false,
      error: 'Account material backfill requires confirmation: BACKFILL_FACEBOOK_ACCOUNT_MATERIALS',
    })
    return
  }

  const requestedAccountId = Array.isArray(req.params.id)
    ? req.params.id[0]
    : req.params.id
  const accountId = normalizeForStorage(requestedAccountId)
  try {
    const account: any = await Account.findOne({
      channel: 'facebook',
      accountId: { $in: accountIdVariants(accountId) },
    })
      .select('accountId organizationId token tokenId operator')
      .lean()
    if (!account) {
      throw Object.assign(new Error(`Facebook account ${accountId} was not found`), {
        statusCode: 404,
      })
    }

    const organizationId = account.organizationId?.toString()
    if (!organizationId) {
      throw Object.assign(new Error(`Facebook account ${accountId} is not assigned to an organization`), {
        statusCode: 409,
      })
    }

    const authorization = await resolveAccountOperationalAuthorization({
      accountId,
      organizationId,
      legacyToken: account.token,
      legacyTokenId: account.tokenId,
    })
    if (!authorization) {
      throw Object.assign(new Error(`Facebook account ${accountId} has no usable authorization`), {
        statusCode: 403,
      })
    }

    const after = typeof req.body?.after === 'string' && req.body.after.length <= 2000
      ? req.body.after
      : undefined
    const result = await backfillFacebookAccountMaterialsPage({
      accountId,
      organizationId,
      token: authorization.token,
      tokenId: authorization.legacyTokenId || account.tokenId?.toString(),
      optimizer: account.operator,
      after,
      limit: req.body?.limit,
      concurrency: req.body?.concurrency,
    })

    await writeAuditLog(req, {
      category: 'facebook',
      action: 'facebook.material.account_backfill.apply',
      status: 'success',
      targetType: 'facebook_account',
      targetId: accountId,
      summary: `执行 Facebook 账户素材回填：处理 ${result.adsProcessed} 条广告，成功 ${result.creativesSucceeded} 个创意，失败 ${result.creativesFailed} 个创意`,
      metadata: {
        ...result,
        nextAfter: result.hasMore ? 'present' : undefined,
      },
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    await writeAuditLog(req, {
      category: 'facebook',
      action: 'facebook.material.account_backfill.apply',
      status: 'failed',
      targetType: 'facebook_account',
      targetId: accountId,
      summary: 'Facebook 账户素材回填失败',
      reason: error.message,
    })
    next(error)
  }
}

export const deduplicateMaterials = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!requireSuperAdmin(req, res)) return

  const dryRun = req.body?.dryRun !== false
  try {
    const result = await deduplicateFacebookMaterials({
      dryRun,
      confirmation: typeof req.body?.confirmation === 'string'
        ? req.body.confirmation
        : undefined,
      maxGroups: typeof req.body?.maxGroups === 'number'
        ? req.body.maxGroups
        : undefined,
    })

    await writeAuditLog(req, {
      category: 'facebook',
      action: dryRun
        ? 'facebook.material.deduplicate.preview'
        : 'facebook.material.deduplicate.apply',
      status: 'success',
      targetType: 'material',
      targetId: 'facebook-imports',
      summary: dryRun
        ? `预览 Facebook 素材去重：${result.duplicateDocuments} 条冗余记录`
        : `执行 Facebook 素材去重：合并 ${result.mergedGroups} 组，归档 ${result.archivedDocuments} 条冗余记录`,
      metadata: result,
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    await writeAuditLog(req, {
      category: 'facebook',
      action: dryRun
        ? 'facebook.material.deduplicate.preview'
        : 'facebook.material.deduplicate.apply',
      status: 'failed',
      targetType: 'material',
      targetId: 'facebook-imports',
      summary: 'Facebook 素材去重失败',
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
  _next: NextFunction,
) => {
  return redirectLegacyInsightsList(req, res, 'campaigns')
}

export const syncAccounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!requireSuperAdmin(req, res)) return
    const result = await facebookAccountsService.syncAccountsFromTokens()
    void runPendingAccountInsightsBackfill().catch((error) => {
      logger.error(
        '[AccountInsightsBackfill] Manual account-sync trigger failed:',
        error instanceof Error ? error.message : String(error),
      )
    })
    void runPendingTokenInsightsBackfill().catch((error) => {
      logger.error(
        '[TokenInsightsBackfill] Manual account-sync trigger failed:',
        error instanceof Error ? error.message : String(error),
      )
    })
    res.json({
      success: true,
      message: 'Accounts sync completed',
      data: { ...result, insightsBackfillScheduled: true },
    })
  } catch (error) {
    next(error)
  }
}

export const getAccountsList = async (
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (!requireSuperAdmin(req, res)) return
  return redirectLegacyInsightsList(req, res, 'accounts')
}

export const getCountriesList = async (
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  return redirectLegacyInsightsList(req, res, 'countries')
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
    const dateRequest = req.query.startDate !== undefined || req.query.endDate !== undefined
      ? buildInsightsDateRequest({
          startDate: req.query.startDate,
          endDate: req.query.endDate,
        })
      : undefined
    const result = await facebookService.getInsightsDaily(id, dateRequest?.timeRange)
    res.json({ success: true, ...result })
  } catch (error) {
    if (sendFacebookDateRangeError(res, error)) return
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
