import { Request, Response } from 'express'
import bulkAdService from '../services/bulkAd.service'
import TargetingPackage from '../models/TargetingPackage'
import CopywritingPackage from '../models/CopywritingPackage'
import CreativeGroup from '../models/CreativeGroup'
import {
  searchTargetingInterests,
  searchTargetingLocations,
  getPages,
  getInstagramAccounts,
  getPixels,
  getCustomConversions,
} from '../integration/facebook/bulkCreate.api'
import FbToken from '../models/FbToken'
import logger from '../utils/logger'
import * as oauthService from '../services/facebook.oauth.service'
import { facebookClient } from '../integration/facebook/facebookClient'

// ==================== 草稿管理 ====================

/**
 * 创建广告草稿
 * POST /api/bulk-ad/drafts
 */
export const createDraft = async (req: Request, res: Response) => {
  try {
    const draft = await bulkAdService.createDraft(req.body)
    res.json({ success: true, data: draft })
  } catch (error: any) {
    logger.error('[BulkAd] Create draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新广告草稿
 * PUT /api/bulk-ad/drafts/:id
 */
export const updateDraft = async (req: Request, res: Response) => {
  try {
    const draft = await bulkAdService.updateDraft(req.params.id, req.body)
    res.json({ success: true, data: draft })
  } catch (error: any) {
    logger.error('[BulkAd] Update draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取草稿详情
 * GET /api/bulk-ad/drafts/:id
 */
export const getDraft = async (req: Request, res: Response) => {
  try {
    const draft = await bulkAdService.getDraft(req.params.id)
    res.json({ success: true, data: draft })
  } catch (error: any) {
    logger.error('[BulkAd] Get draft failed:', error)
    res.status(404).json({ success: false, error: error.message })
  }
}

/**
 * 获取草稿列表
 * GET /api/bulk-ad/drafts
 */
export const getDraftList = async (req: Request, res: Response) => {
  try {
    const result = await bulkAdService.getDraftList(req.query)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get draft list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除草稿
 * DELETE /api/bulk-ad/drafts/:id
 */
export const deleteDraft = async (req: Request, res: Response) => {
  try {
    await bulkAdService.deleteDraft(req.params.id)
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 验证草稿
 * POST /api/bulk-ad/drafts/:id/validate
 */
export const validateDraft = async (req: Request, res: Response) => {
  try {
    const validation = await bulkAdService.validateDraft(req.params.id)
    res.json({ success: true, data: validation })
  } catch (error: any) {
    logger.error('[BulkAd] Validate draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 发布草稿
 * POST /api/bulk-ad/drafts/:id/publish
 */
export const publishDraft = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.publishDraft(req.params.id)
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Publish draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ==================== 任务管理 ====================

/**
 * 获取任务详情
 * GET /api/bulk-ad/tasks/:id
 */
export const getTask = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.getTask(req.params.id)
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Get task failed:', error)
    res.status(404).json({ success: false, error: error.message })
  }
}

/**
 * 获取任务列表
 * GET /api/bulk-ad/tasks
 */
export const getTaskList = async (req: Request, res: Response) => {
  try {
    const result = await bulkAdService.getTaskList(req.query)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get task list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 取消任务
 * POST /api/bulk-ad/tasks/:id/cancel
 */
export const cancelTask = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.cancelTask(req.params.id)
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Cancel task failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 重试失败的任务项
 * POST /api/bulk-ad/tasks/:id/retry
 */
export const retryTask = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.retryFailedItems(req.params.id)
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Retry task failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 重新执行任务（基于原任务配置创建新任务）
 * POST /api/bulk-ad/tasks/:id/rerun
 */
export const rerunTask = async (req: Request, res: Response) => {
  try {
    const newTask = await bulkAdService.rerunTask(req.params.id)
    res.json({ success: true, data: newTask })
  } catch (error: any) {
    logger.error('[BulkAd] Rerun task failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ==================== 定向包管理 ====================

/**
 * 创建定向包
 * POST /api/bulk-ad/targeting-packages
 */
export const createTargetingPackage = async (req: Request, res: Response) => {
  try {
    const pkg = new TargetingPackage(req.body)
    await pkg.save()
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Create targeting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新定向包
 * PUT /api/bulk-ad/targeting-packages/:id
 */
export const updateTargetingPackage = async (req: Request, res: Response) => {
  try {
    const pkg = await TargetingPackage.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    )
    if (!pkg) {
      return res.status(404).json({ success: false, error: 'Targeting package not found' })
    }
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Update targeting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取定向包列表
 * GET /api/bulk-ad/targeting-packages
 */
export const getTargetingPackageList = async (req: Request, res: Response) => {
  try {
    const { accountId, platform, page = 1, pageSize = 20 } = req.query
    
    const filter: any = {}
    if (accountId) filter.accountId = accountId
    if (platform) filter.platform = platform
    
    const [list, total] = await Promise.all([
      TargetingPackage.find(filter)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(pageSize))
        .limit(Number(pageSize))
        .lean(),
      TargetingPackage.countDocuments(filter),
    ])
    
    res.json({ success: true, data: { list, total, page: Number(page), pageSize: Number(pageSize) } })
  } catch (error: any) {
    logger.error('[BulkAd] Get targeting package list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除定向包
 * DELETE /api/bulk-ad/targeting-packages/:id
 */
export const deleteTargetingPackage = async (req: Request, res: Response) => {
  try {
    await TargetingPackage.deleteOne({ _id: req.params.id })
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete targeting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ==================== 文案包管理 ====================

/**
 * 创建文案包
 * POST /api/bulk-ad/copywriting-packages
 */
export const createCopywritingPackage = async (req: Request, res: Response) => {
  try {
    const pkg = new CopywritingPackage(req.body)
    await pkg.save()
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Create copywriting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新文案包
 * PUT /api/bulk-ad/copywriting-packages/:id
 */
export const updateCopywritingPackage = async (req: Request, res: Response) => {
  try {
    const pkg = await CopywritingPackage.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    )
    if (!pkg) {
      return res.status(404).json({ success: false, error: 'Copywriting package not found' })
    }
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Update copywriting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取文案包列表
 * GET /api/bulk-ad/copywriting-packages
 */
export const getCopywritingPackageList = async (req: Request, res: Response) => {
  try {
    const { accountId, platform, page = 1, pageSize = 20 } = req.query
    
    const filter: any = {}
    if (accountId) filter.accountId = accountId
    if (platform) filter.platform = platform
    
    const [list, total] = await Promise.all([
      CopywritingPackage.find(filter)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(pageSize))
        .limit(Number(pageSize))
        .lean(),
      CopywritingPackage.countDocuments(filter),
    ])
    
    res.json({ success: true, data: { list, total, page: Number(page), pageSize: Number(pageSize) } })
  } catch (error: any) {
    logger.error('[BulkAd] Get copywriting package list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除文案包
 * DELETE /api/bulk-ad/copywriting-packages/:id
 */
export const deleteCopywritingPackage = async (req: Request, res: Response) => {
  try {
    await CopywritingPackage.deleteOne({ _id: req.params.id })
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete copywriting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ==================== 创意组管理 ====================

/**
 * 创建创意组
 * POST /api/bulk-ad/creative-groups
 */
export const createCreativeGroup = async (req: Request, res: Response) => {
  try {
    const group = new CreativeGroup(req.body)
    await group.save()
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Create creative group failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新创意组
 * PUT /api/bulk-ad/creative-groups/:id
 */
export const updateCreativeGroup = async (req: Request, res: Response) => {
  try {
    // 使用 findById + save 以触发 pre('save') 钩子更新 materialStats
    const group = await CreativeGroup.findById(req.params.id)
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    
    // 更新字段
    Object.assign(group, req.body)
    await group.save()
    
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Update creative group failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取创意组列表
 * GET /api/bulk-ad/creative-groups
 */
export const getCreativeGroupList = async (req: Request, res: Response) => {
  try {
    const { accountId, platform, page = 1, pageSize = 20 } = req.query
    
    const filter: any = {}
    if (accountId) filter.accountId = accountId
    if (platform) filter.platform = platform
    
    const [list, total] = await Promise.all([
      CreativeGroup.find(filter)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(pageSize))
        .limit(Number(pageSize))
        .lean(),
      CreativeGroup.countDocuments(filter),
    ])
    
    res.json({ success: true, data: { list, total, page: Number(page), pageSize: Number(pageSize) } })
  } catch (error: any) {
    logger.error('[BulkAd] Get creative group list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除创意组
 * DELETE /api/bulk-ad/creative-groups/:id
 */
export const deleteCreativeGroup = async (req: Request, res: Response) => {
  try {
    await CreativeGroup.deleteOne({ _id: req.params.id })
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete creative group failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 添加素材到创意组
 * POST /api/bulk-ad/creative-groups/:id/materials
 */
export const addMaterial = async (req: Request, res: Response) => {
  try {
    const group = await CreativeGroup.findById(req.params.id)
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    
    group.materials.push(req.body)
    await group.save()
    
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Add material failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 删除创意组中的素材
 * DELETE /api/bulk-ad/creative-groups/:id/materials/:materialId
 */
export const removeMaterial = async (req: Request, res: Response) => {
  try {
    const group: any = await CreativeGroup.findById(req.params.id)
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    
    group.materials = group.materials.filter(
      (m: any) => m._id.toString() !== req.params.materialId
    )
    await group.save()
    
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Remove material failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ==================== Facebook 搜索 API ====================

/**
 * 搜索兴趣标签
 * GET /api/bulk-ad/search/interests
 */
export const searchInterests = async (req: Request, res: Response) => {
  try {
    const { q, type = 'adinterest', limit = 50 } = req.query
    
    const fbToken = await FbToken.findOne({ status: 'active' })
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await searchTargetingInterests({
      token: fbToken.token,
      query: q as string,
      type: type as string,
      limit: Number(limit),
    })
    
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Search interests failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 搜索地理位置
 * GET /api/bulk-ad/search/locations
 */
export const searchLocations = async (req: Request, res: Response) => {
  try {
    const { q, type = 'adgeolocation', limit = 50 } = req.query
    
    const fbToken = await FbToken.findOne({ status: 'active' })
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await searchTargetingLocations({
      token: fbToken.token,
      query: q as string,
      type: type as string,
      limit: Number(limit),
    })
    
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Search locations failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Facebook Pages
 * GET /api/bulk-ad/facebook/pages
 */
export const getFacebookPages = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' })
    }
    
    const fbToken = await FbToken.findOne({ status: 'active' })
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await getPages(accountId as string, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get Facebook pages failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Instagram 账户
 * GET /api/bulk-ad/facebook/instagram-accounts
 */
export const getFacebookInstagramAccounts = async (req: Request, res: Response) => {
  try {
    const { pageId } = req.query
    if (!pageId) {
      return res.status(400).json({ success: false, error: 'pageId is required' })
    }
    
    const fbToken = await FbToken.findOne({ status: 'active' })
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await getInstagramAccounts(pageId as string, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get Instagram accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Pixels
 * GET /api/bulk-ad/facebook/pixels
 */
export const getFacebookPixels = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' })
    }
    
    const fbToken = await FbToken.findOne({ status: 'active' })
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await getPixels(accountId as string, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get Facebook pixels failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取自定义转化事件
 * GET /api/bulk-ad/facebook/custom-conversions
 */
export const getFacebookCustomConversions = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' })
    }
    
    const fbToken = await FbToken.findOne({ status: 'active' })
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await getCustomConversions(accountId as string, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get custom conversions failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 独立 OAuth 授权 ====================

/**
 * 获取 Facebook 登录 URL（批量广告专用）
 * GET /api/bulk-ad/auth/login-url
 */
export const getAuthLoginUrl = async (req: Request, res: Response) => {
  try {
    const config = oauthService.validateOAuthConfig()
    if (!config.valid) {
      return res.status(500).json({
        success: false,
        error: `OAuth 配置不完整，缺少: ${config.missing.join(', ')}`,
      })
    }
    
    // 使用特殊 state 标记来自批量广告模块
    const loginUrl = oauthService.getFacebookLoginUrl('bulk-ad')
    
    res.json({
      success: true,
      data: { loginUrl },
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get login URL failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * OAuth 回调处理（批量广告专用）
 * GET /api/bulk-ad/auth/callback
 */
export const handleAuthCallback = async (req: Request, res: Response) => {
  try {
    const { code, error, error_description, state } = req.query
    
    if (error) {
      logger.error('[BulkAd OAuth] Facebook returned error:', { error, error_description })
      return res.redirect(
        `/bulk-ad/create?oauth_error=${encodeURIComponent(error_description as string || error as string)}`
      )
    }
    
    if (!code) {
      return res.redirect('/bulk-ad/create?oauth_error=No authorization code received')
    }
    
    // 处理 OAuth 回调
    const result = await oauthService.handleOAuthCallback(code as string)
    
    // 重定向到批量广告创建页面
    const params = new URLSearchParams({
      oauth_success: 'true',
      token_id: result.tokenId,
      fb_user_id: result.fbUserId,
      fb_user_name: encodeURIComponent(result.fbUserName || ''),
    })
    
    res.redirect(`/bulk-ad/create?${params.toString()}`)
  } catch (error: any) {
    logger.error('[BulkAd OAuth] Callback handler failed:', error)
    res.redirect(`/bulk-ad/create?oauth_error=${encodeURIComponent(error.message || 'OAuth callback failed')}`)
  }
}

/**
 * 检查授权状态
 * GET /api/bulk-ad/auth/status
 */
export const getAuthStatus = async (req: Request, res: Response) => {
  try {
    const fbToken: any = await FbToken.findOne({ status: 'active' }).sort({ updatedAt: -1 })
    
    if (!fbToken) {
      return res.json({
        success: true,
        data: {
          authorized: false,
          message: '未授权 Facebook 账号',
        },
      })
    }
    
    res.json({
      success: true,
      data: {
        authorized: true,
        tokenId: fbToken._id,
        fbUserId: fbToken.fbUserId,
        fbUserName: fbToken.fbUserName,
        expiresAt: fbToken.expiresAt,
      },
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get auth status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取当前授权用户的广告账户列表
 * GET /api/bulk-ad/auth/ad-accounts
 */
export const getAuthAdAccounts = async (req: Request, res: Response) => {
  try {
    const fbToken: any = await FbToken.findOne({ status: 'active' }).sort({ updatedAt: -1 })
    if (!fbToken) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    // 获取用户的广告账户
    const result = await facebookClient.get('/me/adaccounts', {
      access_token: fbToken.token,
      fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance',
      limit: 100,
    })
    
    const accounts = (result.data || []).map((acc: any) => ({
      id: acc.id,
      account_id: acc.account_id,
      name: acc.name,
      account_status: acc.account_status,
      currency: acc.currency,
      timezone_name: acc.timezone_name,
      amount_spent: acc.amount_spent,
      balance: acc.balance,
    }))
    
    res.json({ success: true, data: accounts })
  } catch (error: any) {
    logger.error('[BulkAd] Get ad accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取账户的 Pages
 * GET /api/bulk-ad/auth/pages
 */
export const getAuthPages = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' })
    }
    
    const fbToken: any = await FbToken.findOne({ status: 'active' }).sort({ updatedAt: -1 })
    if (!fbToken) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    const result = await facebookClient.get(`/act_${accountId}/promote_pages`, {
      access_token: fbToken.token,
      fields: 'id,name,picture',
      limit: 100,
    })
    
    res.json({ success: true, data: result.data || [] })
  } catch (error: any) {
    logger.error('[BulkAd] Get pages failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取账户的 Pixels
 * GET /api/bulk-ad/auth/pixels
 */
export const getAuthPixels = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' })
    }
    
    const fbToken: any = await FbToken.findOne({ status: 'active' }).sort({ updatedAt: -1 })
    if (!fbToken) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    const result = await facebookClient.get(`/act_${accountId}/adspixels`, {
      access_token: fbToken.token,
      fields: 'id,name,code,last_fired_time',
      limit: 100,
    })
    
    res.json({ success: true, data: result.data || [] })
  } catch (error: any) {
    logger.error('[BulkAd] Get pixels failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

