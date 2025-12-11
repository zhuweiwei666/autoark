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
import { parseProductUrl } from '../services/productMapping.service'
import { getOrgFilter } from '../middlewares/auth'
import { UserRole } from '../models/User'

// ==================== 草稿管理 ====================

/**
 * 创建广告草稿
 * POST /api/bulk-ad/drafts
 */
export const createDraft = async (req: Request, res: Response) => {
  try {
    // Debug: 打印接收到的账户配置
    logger.info('[BulkAd] createDraft received accounts:', JSON.stringify(req.body.accounts?.map((a: any) => ({
      accountId: a.accountId,
      pixelId: a.pixelId,
      pixelName: a.pixelName
    }))))
    
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
 * @body multiplier 执行倍率（可选，默认1，最大20）
 */
export const rerunTask = async (req: Request, res: Response) => {
  try {
    const multiplier = parseInt(req.body.multiplier) || 1
    const newTasks = await bulkAdService.rerunTask(req.params.id, multiplier)
    res.json({ success: true, data: newTasks })
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
    const data = { ...req.body, organizationId: req.user?.organizationId }
    const pkg = new TargetingPackage(data)
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
    
    const filter: any = { ...getOrgFilter(req) }
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
    const data = { ...req.body, organizationId: req.user?.organizationId }
    
    // 自动从 websiteUrl 提取产品信息
    if (data.links?.websiteUrl && !data.product?.name) {
      const parsed = parseProductUrl(data.links.websiteUrl)
      if (parsed) {
        data.product = {
          name: parsed.productName || parsed.domain,
          identifier: parsed.productIdentifier,
          domain: parsed.domain,
          autoExtracted: true,
        }
        logger.info(`[BulkAd] Auto-extracted product: ${data.product.name} from ${data.links.websiteUrl}`)
      }
    }
    
    const pkg = new CopywritingPackage(data)
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
    const data = { ...req.body }
    
    // 如果更新了 websiteUrl，自动重新提取产品信息
    if (data.links?.websiteUrl) {
      const existingPkg = await CopywritingPackage.findById(req.params.id)
      const urlChanged = existingPkg?.links?.websiteUrl !== data.links.websiteUrl
      const productNotManual = !existingPkg?.product || existingPkg.product.autoExtracted !== false
      
      if (urlChanged && productNotManual) {
        const parsed = parseProductUrl(data.links.websiteUrl)
        if (parsed) {
          data.product = {
            name: parsed.productName || parsed.domain,
            identifier: parsed.productIdentifier,
            domain: parsed.domain,
            autoExtracted: true,
          }
          logger.info(`[BulkAd] Auto-updated product: ${data.product.name} from ${data.links.websiteUrl}`)
        }
      }
    }
    
    const pkg = await CopywritingPackage.findByIdAndUpdate(
      req.params.id,
      data,
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
    
    const filter: any = { ...getOrgFilter(req) }
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

/**
 * 批量解析所有文案包的产品信息
 * POST /api/bulk-ad/copywriting-packages/parse-products
 */
export const parseAllCopywritingProducts = async (req: Request, res: Response) => {
  try {
    const packages = await CopywritingPackage.find({
      'links.websiteUrl': { $exists: true, $ne: '' },
      $or: [
        { 'product.name': { $exists: false } },
        { 'product.name': '' },
        { 'product.name': null },
      ]
    })
    
    let updated = 0
    let failed = 0
    const results: Array<{ id: string; name: string; productName?: string; error?: string }> = []
    
    for (const pkg of packages) {
      try {
        const urlString = pkg.links?.websiteUrl
        if (!urlString) continue
        
        const parsed = parseProductUrl(urlString)
        if (parsed) {
          pkg.product = {
            name: parsed.productName || parsed.domain,
            identifier: parsed.productIdentifier,
            domain: parsed.domain,
            autoExtracted: true,
          }
          await pkg.save()
          updated++
          results.push({ id: pkg._id.toString(), name: pkg.name, productName: parsed.productName })
        }
      } catch (error: any) {
        failed++
        results.push({ id: pkg._id.toString(), name: pkg.name, error: error.message })
      }
    }
    
    res.json({ 
      success: true, 
      data: { 
        total: packages.length,
        updated, 
        failed,
        results 
      } 
    })
  } catch (error: any) {
    logger.error('[BulkAd] Parse all copywriting products failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 创意组管理 ====================

/**
 * 创建创意组
 * POST /api/bulk-ad/creative-groups
 */
export const createCreativeGroup = async (req: Request, res: Response) => {
  try {
    const data = { ...req.body, organizationId: req.user?.organizationId }
    const group = new CreativeGroup(data)
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
    const group = await CreativeGroup.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    )
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
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
    
    const filter: any = { ...getOrgFilter(req) }
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
 * 获取可用的 Facebook Apps 列表
 * GET /api/bulk-ad/auth/apps
 */
export const getAvailableApps = async (req: Request, res: Response) => {
  try {
    const apps = await oauthService.getAvailableApps()
    res.json({ success: true, data: apps })
  } catch (error: any) {
    logger.error('[BulkAd] Get available apps failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Facebook 登录 URL（批量广告专用，支持选择 App）
 * GET /api/bulk-ad/auth/login-url
 * 
 * 用户隔离：
 * 1. 如果用户已有 Token，使用该 Token 上次授权时的 App
 * 2. 如果指定了 appId 参数，使用指定的 App
 * 3. 否则使用默认 App
 */
export const getAuthLoginUrl = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }
    
    let appId = req.query.appId as string | undefined
    
    // 如果没有指定 App，尝试从用户现有的 Token 获取上次使用的 App
    if (!appId) {
      const existingToken = await FbToken.findOne({ 
        userId: req.user.userId,
        status: 'active'
      }).sort({ updatedAt: -1 })
      
      if (existingToken?.lastAuthAppId) {
        appId = existingToken.lastAuthAppId
        logger.info(`[BulkAd] Using user's previous App: ${appId}`)
      }
    }
    
    const config = await oauthService.validateOAuthConfig()
    if (!config.valid) {
      return res.status(500).json({
        success: false,
        error: config.hasDbApps 
          ? `OAuth 配置不完整，缺少: ${config.missing.join(', ')}`
          : '未配置 Facebook App，请在 App 管理页面添加',
        needsAppSetup: !config.hasDbApps,
      })
    }
    
    // 将 AutoArk 用户 ID 编码到 state 参数中
    // 格式: bulk-ad|userId|organizationId
    const stateData = `bulk-ad|${req.user.userId}|${req.user.organizationId || ''}`
    const loginUrl = await oauthService.getFacebookLoginUrl(stateData, appId)
    
    logger.info(`[BulkAd] Generated login URL for user ${req.user.userId}, App: ${appId || 'default'}`)
    
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
 * 
 * 用户隔离：从 state 参数解析 AutoArk 用户 ID，并将 token 与该用户关联
 */
export const handleAuthCallback = async (req: Request, res: Response) => {
  try {
    const { code, error, error_description, state } = req.query
    
    if (error) {
      logger.error('[BulkAd OAuth] Facebook returned error:', { error, error_description })
      return res.redirect(
        `/oauth/callback?oauth_error=${encodeURIComponent(error_description as string || error as string)}`
      )
    }
    
    if (!code) {
      return res.redirect('/oauth/callback?oauth_error=No authorization code received')
    }
    
    // 解析 state 参数获取 AutoArk 用户信息
    // 格式: bulk-ad|userId|organizationId|appId（appId 可选）
    let autoarkUserId: string | undefined
    let organizationId: string | undefined
    if (state) {
      const parts = (state as string).split('|')
      if (parts[0] === 'bulk-ad' && parts[1]) {
        autoarkUserId = parts[1]
        organizationId = parts[2] || undefined
        logger.info(`[BulkAd OAuth] Binding token to AutoArk user: ${autoarkUserId}`)
      }
    }
    
    // 处理 OAuth 回调（传递 state 以解析使用的 App）
    const result = await oauthService.handleOAuthCallback(code as string, state as string | undefined)
    
    // 更新 Token 的 userId 和 organizationId（关联到 AutoArk 用户）
    if (autoarkUserId) {
      await FbToken.findByIdAndUpdate(result.tokenId, {
        userId: autoarkUserId,
        ...(organizationId && { organizationId }),
      })
      logger.info(`[BulkAd OAuth] Token ${result.tokenId} bound to user ${autoarkUserId}`)
    }
    
    // 异步同步 Facebook 用户资产
    const facebookUserService = require('../services/facebookUser.service')
    facebookUserService.syncFacebookUserAssets(
      result.fbUserId, 
      result.accessToken,
      result.tokenId
    ).catch((err: any) => {
      logger.error('[BulkAd OAuth] Failed to sync Facebook user assets:', err)
    })
    
    // 重定向到专门的 OAuth 回调页面
    const params = new URLSearchParams({
      oauth_success: 'true',
      token_id: result.tokenId,
      fb_user_id: result.fbUserId,
      fb_user_name: encodeURIComponent(result.fbUserName || ''),
    })
    
    res.redirect(`/oauth/callback?${params.toString()}`)
  } catch (error: any) {
    logger.error('[BulkAd OAuth] Callback handler failed:', error)
    res.redirect(`/oauth/callback?oauth_error=${encodeURIComponent(error.message || 'OAuth callback failed')}`)
  }
}

/**
 * 检查授权状态（用户隔离）
 * GET /api/bulk-ad/auth/status
 * 
 * 每个 AutoArk 用户看到自己绑定的 Facebook 账号
 * 超级管理员可以看到所有 token
 */
export const getAuthStatus = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }
    
    // 构建查询条件
    const tokenQuery: any = { status: 'active' }
    
    // 超级管理员看到所有，普通用户只看到自己绑定的或本组织的
    if (req.user.role === UserRole.SUPER_ADMIN) {
      // 超级管理员：获取所有活跃 token，优先显示自己绑定的
      const userToken = await FbToken.findOne({ 
        status: 'active', 
        userId: req.user.userId 
      }).sort({ updatedAt: -1 })
      
      if (userToken) {
        return res.json({
          success: true,
          data: {
            authorized: true,
            tokenId: userToken._id,
            fbUserId: userToken.fbUserId,
            fbUserName: userToken.fbUserName,
            expiresAt: userToken.expiresAt,
            isOwnToken: true,
          },
        })
      }
      
      // 如果超级管理员没有绑定自己的 token，显示第一个可用的
      const anyToken: any = await FbToken.findOne({ status: 'active' }).sort({ updatedAt: -1 })
      if (anyToken) {
        return res.json({
          success: true,
          data: {
            authorized: true,
            tokenId: anyToken._id,
            fbUserId: anyToken.fbUserId,
            fbUserName: anyToken.fbUserName,
            expiresAt: anyToken.expiresAt,
            isOwnToken: false,
            message: '当前使用的是其他用户的授权，建议绑定自己的 Facebook 账号',
          },
        })
      }
    } else {
      // 普通用户：只看到自己绑定的 token
      tokenQuery.userId = req.user.userId
      // 如果有组织，也可以看到同组织的
      if (req.user.organizationId) {
        tokenQuery.$or = [
          { userId: req.user.userId },
          { organizationId: req.user.organizationId }
        ]
        delete tokenQuery.userId
      }
    }
    
    const fbToken: any = await FbToken.findOne(tokenQuery).sort({ updatedAt: -1 })
    
    if (!fbToken) {
      return res.json({
        success: true,
        data: {
          authorized: false,
          message: '请先绑定您的 Facebook 账号',
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
        isOwnToken: fbToken.userId === req.user.userId,
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
 * 需要认证，并根据用户组织进行权限过滤
 * 
 * 超级管理员：获取所有 token 下的所有账户
 * 普通用户：只获取本组织 token 下的账户
 */
export const getAuthAdAccounts = async (req: Request, res: Response) => {
  try {
    // 检查用户认证
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }

    // 构建 token 查询条件（根据组织隔离）
    const tokenQuery: any = { status: 'active' }
    // 如果不是超级管理员，只查询本组织的 token
    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.organizationId) {
      tokenQuery.organizationId = req.user.organizationId
    }

    // 查找所有符合条件的 token（超级管理员看到所有，普通用户只看到本组织）
    const fbTokens: any[] = await FbToken.find(tokenQuery).sort({ updatedAt: -1 })
    if (!fbTokens || fbTokens.length === 0) {
      return res.status(401).json({ success: false, error: '未找到可用的 Facebook 授权账号' })
    }
    
    // 合并所有 token 下的广告账户
    const allAccounts: any[] = []
    const seenAccountIds = new Set<string>()
    
    for (const fbToken of fbTokens) {
      try {
        const result = await facebookClient.get('/me/adaccounts', {
          access_token: fbToken.token,
          fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance',
          limit: 100,
        })
        
        for (const acc of (result.data || [])) {
          // 避免重复账户
          if (!seenAccountIds.has(acc.account_id)) {
            seenAccountIds.add(acc.account_id)
            allAccounts.push({
              id: acc.id,
              account_id: acc.account_id,
              name: acc.name,
              account_status: acc.account_status,
              currency: acc.currency,
              timezone_name: acc.timezone_name,
              amount_spent: acc.amount_spent,
              balance: acc.balance,
              // 额外信息：标记来源 token
              _tokenOwner: fbToken.fbUserName || fbToken.optimizer || 'unknown',
            })
          }
        }
      } catch (tokenError: any) {
        logger.warn(`[BulkAd] Failed to get accounts for token ${fbToken.fbUserName}: ${tokenError.message}`)
        // 继续处理其他 token
      }
    }
    
    // 根据 Account 模型中的 organizationId 进行过滤（仅非超级管理员）
    let filteredAccounts = allAccounts
    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.organizationId) {
      const Account = require('../models/Account').default
      const allowedAccounts = await Account.find({
        accountId: { $in: Array.from(seenAccountIds) },
        organizationId: req.user.organizationId,
      }).select('accountId').lean()
      const allowedAccountIds = new Set(allowedAccounts.map((acc: any) => acc.accountId))
      filteredAccounts = allAccounts.filter((acc: any) => allowedAccountIds.has(acc.account_id))
    }
    
    res.json({ success: true, data: filteredAccounts })
  } catch (error: any) {
    logger.error('[BulkAd] Get ad accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取账户的 Pages
 * GET /api/bulk-ad/auth/pages
 * 
 * 策略：
 * 1. 先尝试从广告账户获取 promote_pages（BM 分配的主页）
 * 2. 如果没有结果，回退获取用户有广告权限的所有主页
 */
export const getAuthPages = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' })
    }
    
    // 🔧 修复：根据账户 ID 找到正确的 token
    let fbToken: any = null
    
    // 1. 尝试找到有权限访问此账户的 token
    const allTokens = await FbToken.find({ status: 'active' })
    for (const t of allTokens) {
      try {
        // 验证此 token 是否有权访问该账户
        const res = await facebookClient.get(`/act_${accountId}`, { 
          access_token: t.token,
          fields: 'id,name'
        })
        if (res && res.id) {
          fbToken = t
          logger.info(`[BulkAd] Found token for account ${accountId}: ${t.fbUserName}`)
          break
        }
      } catch (e: any) {
        // 这个 token 没有权限，继续尝试下一个
      }
    }
    
    if (!fbToken) {
      return res.status(401).json({ success: false, error: `没有找到可访问账户 ${accountId} 的 Token` })
    }
    
    // 1. 从广告账户获取 promote_pages（BM 分配的主页）
    let pages: any[] = []
    try {
      const promoteResult = await facebookClient.get(`/act_${accountId}/promote_pages`, {
        access_token: fbToken.token,
        fields: 'id,name,picture',
        limit: 100,
      })
      pages = promoteResult.data || []
      logger.info(`[BulkAd] Found ${pages.length} promote_pages for account ${accountId}`)
    } catch (e: any) {
      logger.warn(`[BulkAd] Failed to get promote_pages for ${accountId}: ${e.message}`)
    }
    
    // 2. 如果没有 promote_pages，警告用户需要在 BM 中配置
    if (pages.length === 0) {
      logger.warn(`[BulkAd] Account ${accountId} has no promote_pages - need BM configuration`)
      // 不再回退到用户主页，因为那会导致权限问题
      // 返回空数组并在响应中提示
      return res.json({ 
        success: true, 
        data: [],
        warning: '此广告账户没有被分配任何 Facebook 主页。请在 Business Manager 中将主页分配给此账户。'
      })
    }
    
    res.json({ success: true, data: pages })
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

/**
 * 获取缓存的所有 Pixels（预加载，速度快）
 * GET /api/bulk-ad/auth/cached-pixels
 * 
 * 超级管理员：合并所有 token 的 Pixels
 * 普通用户：只获取本组织 token 的 Pixels
 */
export const getCachedPixels = async (req: Request, res: Response) => {
  try {
    // 构建 token 查询条件（根据组织隔离）
    const tokenQuery: any = { status: 'active' }
    // 如果不是超级管理员，只查询本组织的 token
    if (req.user?.role !== UserRole.SUPER_ADMIN && req.user?.organizationId) {
      tokenQuery.organizationId = req.user.organizationId
    }
    
    const fbTokens: any[] = await FbToken.find(tokenQuery).sort({ updatedAt: -1 })
    if (!fbTokens || fbTokens.length === 0) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    const facebookUserService = require('../services/facebookUser.service')
    
    // 合并所有 token 的 Pixels
    const pixelMap = new Map<string, any>()
    
    for (const fbToken of fbTokens) {
      try {
        const pixels = await facebookUserService.getCachedPixels(fbToken.fbUserId)
        
        for (const p of pixels) {
          const existing = pixelMap.get(p.pixelId)
          if (existing) {
            // 合并账户列表（去重）
            const existingAccountIds = new Set(existing.accounts.map((a: any) => a.accountId))
            for (const acc of (p.accounts || [])) {
              if (!existingAccountIds.has(acc.accountId)) {
                existing.accounts.push(acc)
              }
            }
          } else {
            pixelMap.set(p.pixelId, {
              pixelId: p.pixelId,
              name: p.name,
              accounts: [...(p.accounts || [])],
            })
          }
        }
      } catch (tokenError: any) {
        logger.warn(`[BulkAd] Failed to get pixels for token ${fbToken.fbUserName}:`, tokenError.message)
      }
    }
    
    // 转换格式以兼容前端
    const formattedPixels = Array.from(pixelMap.values()).map((p: any) => ({
      id: p.pixelId,
      name: p.name,
      accounts: p.accounts || [],
    }))
    
    logger.info(`[BulkAd] Merged ${formattedPixels.length} pixels from ${fbTokens.length} tokens`)
    
    res.json({ success: true, data: formattedPixels })
  } catch (error: any) {
    logger.error('[BulkAd] Get cached pixels failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Pixel 同步状态
 * GET /api/bulk-ad/auth/sync-status
 */
export const getPixelSyncStatus = async (req: Request, res: Response) => {
  try {
    const fbToken: any = await FbToken.findOne({ status: 'active' }).sort({ updatedAt: -1 })
    if (!fbToken) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    const facebookUserService = require('../services/facebookUser.service')
    const status = await facebookUserService.getSyncStatus(fbToken.fbUserId)
    
    res.json({ success: true, data: status })
  } catch (error: any) {
    logger.error('[BulkAd] Get sync status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 手动触发重新同步
 * POST /api/bulk-ad/auth/resync
 */
export const resyncFacebookAssets = async (req: Request, res: Response) => {
  try {
    const fbToken: any = await FbToken.findOne({ status: 'active' }).sort({ updatedAt: -1 })
    if (!fbToken) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    const facebookUserService = require('../services/facebookUser.service')
    
    // 异步执行同步
    facebookUserService.syncFacebookUserAssets(
      fbToken.fbUserId, 
      fbToken.token,
      fbToken._id.toString()
    ).catch((err: any) => {
      logger.error('[BulkAd] Resync failed:', err)
    })
    
    res.json({ success: true, message: '同步已开始，请稍后刷新' })
  } catch (error: any) {
    logger.error('[BulkAd] Resync trigger failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 广告审核状态 ====================

/**
 * 获取任务的广告审核状态
 * GET /api/bulk-ad/tasks/:id/review-status
 */
export const getTaskReviewStatus = async (req: Request, res: Response) => {
  try {
    const { getTaskReviewDetails } = await import('../services/adReview.service')
    const result = await getTaskReviewDetails(req.params.id)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get task review status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 检查/刷新任务的广告审核状态
 * POST /api/bulk-ad/tasks/:id/check-review
 */
export const checkTaskReviewStatus = async (req: Request, res: Response) => {
  try {
    const { updateTaskAdsReviewStatus } = await import('../services/adReview.service')
    const result = await updateTaskAdsReviewStatus(req.params.id)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Check task review status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取所有 AutoArk 广告审核概览
 * GET /api/bulk-ad/ads/review-overview
 */
export const getAdsReviewOverview = async (req: Request, res: Response) => {
  try {
    const { getReviewOverview } = await import('../services/adReview.service')
    const result = await getReviewOverview()
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get ads review overview failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 刷新所有 AutoArk 广告的审核状态
 * POST /api/bulk-ad/ads/refresh-review
 */
export const refreshAdsReviewStatus = async (req: Request, res: Response) => {
  try {
    const { refreshAllReviewStatus } = await import('../services/adReview.service')
    const result = await refreshAllReviewStatus()
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Refresh ads review status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

