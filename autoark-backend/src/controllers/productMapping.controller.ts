import { Request, Response } from 'express'
import logger from '../utils/logger'
import Product from '../models/Product'
import Account from '../models/Account'
import FbToken from '../models/FbToken'
import FacebookUser from '../models/FacebookUser'
import * as productMappingService from '../services/productMapping.service'
import {
  combineFilters,
  sanitizeScopedUpdate,
  scopedOwnerFilter,
  scopedTokenFilter,
} from '../utils/accessControl'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'

/**
 * 产品映射控制器
 * 提供产品关系管理的 API 接口
 */

// ==================== 产品 CRUD ====================

const getProductFilter = (req: Request): any => scopedOwnerFilter(req)

const getOwnerData = (req: Request): any => ({
  ...(req.user?.organizationId && { organizationId: req.user.organizationId }),
  ...(req.user?.userId && { createdBy: req.user.userId }),
})

const getScopedAccountAsset = async (req: Request, rawAccountId: any) => {
  const accountId = normalizeForStorage(Array.isArray(rawAccountId) ? rawAccountId[0] : rawAccountId)
  if (!accountId) {
    const error: any = new Error('accountId is required')
    error.statusCode = 400
    throw error
  }

  const account = await Account.findOne(combineFilters(
    {
      channel: 'facebook',
      accountId: { $in: getAccountIdsForQuery([accountId]) },
    },
    getProductFilter(req),
  ))
    .select('accountId name')
    .lean()

  if (!account) {
    const error: any = new Error(`无权绑定广告账户 ${accountId}，请先同步并分配账户资产`)
    error.statusCode = 403
    throw error
  }

  return {
    accountId,
    accountName: account.name,
  }
}

const getScopedPixelAsset = async (req: Request, rawPixelId: any) => {
  const pixelId = Array.isArray(rawPixelId) ? rawPixelId[0] : rawPixelId
  if (!pixelId) {
    const error: any = new Error('pixelId is required')
    error.statusCode = 400
    throw error
  }

  const tokens: any[] = await FbToken.find({ status: 'active', ...scopedTokenFilter(req) })
    .select('_id fbUserId organizationId')
    .lean()
  if (tokens.length === 0) {
    const error: any = new Error('未授权 Facebook 账号')
    error.statusCode = 401
    throw error
  }

  const tokenIds = tokens.map(token => token._id).filter(Boolean)
  const fbUserIds = tokens.map(token => token.fbUserId).filter(Boolean)
  const userFilters: any[] = tokenIds.length > 0 ? [{ tokenId: { $in: tokenIds } }] : []
  if (fbUserIds.length > 0) {
    userFilters.push({
      fbUserId: { $in: fbUserIds },
      ...(req.user?.organizationId && { organizationId: req.user.organizationId }),
    })
  }

  const users: any[] = userFilters.length > 0 ? await FacebookUser.find({ $or: userFilters }).lean() : []
  for (const user of users) {
    const pixel = (user.pixels || []).find((item: any) => item.pixelId === pixelId)
    if (pixel) {
      return {
        pixelId,
        pixelName: pixel.name,
      }
    }
  }

  const error: any = new Error(`无权绑定 Pixel ${pixelId}，请先同步 Facebook 资产后重新选择`)
  error.statusCode = 403
  throw error
}

/**
 * 获取所有产品
 * GET /api/product-mapping/products
 */
export const getProducts = async (req: Request, res: Response) => {
  try {
    const { status, hasPixel, hasAccount, search } = req.query
    let query: any = getProductFilter(req)
    
    if (status) query = combineFilters(query, { status })
    if (hasPixel === 'true') query = combineFilters(query, { 'pixels.0': { $exists: true } })
    if (hasPixel === 'false') query = combineFilters(query, { 'pixels.0': { $exists: false } })
    if (hasAccount === 'true') query = combineFilters(query, { 'accounts.0': { $exists: true } })
    if (hasAccount === 'false') query = combineFilters(query, { 'accounts.0': { $exists: false } })
    if (search) {
      query = combineFilters(query, {
        $or: [
        { name: { $regex: search, $options: 'i' } },
        { identifier: { $regex: search, $options: 'i' } },
        { primaryDomain: { $regex: search, $options: 'i' } },
        ],
      })
    }
    
    const products = await Product.find(query)
      .sort({ updatedAt: -1 })
      .populate('copywritingPackageIds', 'name')
    
    res.json({
      success: true,
      data: products,
      total: products.length,
    })
  } catch (error: any) {
    logger.error('[ProductMapping] Get products failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取单个产品详情
 * GET /api/product-mapping/products/:id
 */
export const getProductById = async (req: Request, res: Response) => {
  try {
    const product = await Product.findOne(combineFilters({ _id: req.params.id }, getProductFilter(req)))
      .populate('copywritingPackageIds', 'name links')
    
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    
    res.json({ success: true, data: product })
  } catch (error: any) {
    logger.error('[ProductMapping] Get product failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 创建产品
 * POST /api/product-mapping/products
 */
export const createProduct = async (req: Request, res: Response) => {
  try {
    const { name, identifier, primaryDomain, description, tags, category } = req.body
    
    if (!name || !identifier) {
      return res.status(400).json({ success: false, error: 'name and identifier are required' })
    }
    
    const existing = await Product.findOne(combineFilters({ identifier }, getProductFilter(req)))
    if (existing) {
      return res.status(400).json({ success: false, error: 'Product with this identifier already exists' })
    }
    
    const product = await Product.create({
      name,
      identifier,
      primaryDomain,
      description,
      tags,
      category,
      ...getOwnerData(req),
    })
    
    res.json({ success: true, data: product })
  } catch (error: any) {
    logger.error('[ProductMapping] Create product failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 更新产品
 * PUT /api/product-mapping/products/:id
 */
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const product = await Product.findOneAndUpdate(
      combineFilters({ _id: req.params.id }, getProductFilter(req)),
      { $set: sanitizeScopedUpdate(req.body) },
      { new: true }
    )
    
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    
    res.json({ success: true, data: product })
  } catch (error: any) {
    logger.error('[ProductMapping] Update product failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== Pixel 管理 ====================

/**
 * 手动添加 Pixel 关联
 * POST /api/product-mapping/products/:id/pixels
 */
export const addPixelToProduct = async (req: Request, res: Response) => {
  try {
    const { pixelId, pixelName, verified } = req.body
    const scopedPixel = await getScopedPixelAsset(req, pixelId)
    
    const product = await Product.findOne(combineFilters({ _id: req.params.id }, getProductFilter(req)))
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    
    // 检查是否已存在
    const existing = product.pixels.find((p: any) => p.pixelId === pixelId)
    if (existing) {
      return res.status(400).json({ success: false, error: 'Pixel already linked to this product' })
    }
    
    product.pixels.push({
      pixelId: scopedPixel.pixelId,
      pixelName: pixelName || scopedPixel.pixelName,
      confidence: 100,
      matchMethod: 'manual',
      verified: verified !== false,
      verifiedAt: new Date(),
    })
    
    // 设为主 Pixel（如果是第一个）
    if (!product.primaryPixelId) {
      product.primaryPixelId = pixelId
    }
    
    await product.save()
    
    res.json({ success: true, data: product })
  } catch (error: any) {
    logger.error('[ProductMapping] Add pixel failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

/**
 * 移除 Pixel 关联
 * DELETE /api/product-mapping/products/:id/pixels/:pixelId
 */
export const removePixelFromProduct = async (req: Request, res: Response) => {
  try {
    const product = await Product.findOne(combineFilters({ _id: req.params.id }, getProductFilter(req)))
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    
    // 使用 $pull 操作或类型转换来避免类型错误
    const filteredPixels = product.pixels.filter((p: any) => p.pixelId !== req.params.pixelId)
    product.set('pixels', filteredPixels)
    
    // 如果删除的是主 Pixel，重新设置
    if (product.primaryPixelId === req.params.pixelId) {
      product.primaryPixelId = product.pixels[0]?.pixelId || null
    }
    
    await product.save()
    
    res.json({ success: true, data: product })
  } catch (error: any) {
    logger.error('[ProductMapping] Remove pixel failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 设置主 Pixel
 * PUT /api/product-mapping/products/:id/primary-pixel
 */
export const setPrimaryPixel = async (req: Request, res: Response) => {
  try {
    const { pixelId } = req.body
    
    const product = await Product.findOne(combineFilters({ _id: req.params.id }, getProductFilter(req)))
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    
    const pixelExists = product.pixels.find((p: any) => p.pixelId === pixelId)
    if (!pixelExists) {
      return res.status(400).json({ success: false, error: 'Pixel not linked to this product' })
    }
    
    product.primaryPixelId = pixelId
    await product.save()
    
    res.json({ success: true, data: product })
  } catch (error: any) {
    logger.error('[ProductMapping] Set primary pixel failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 账户管理 ====================

/**
 * 获取产品的可用投放账户
 * GET /api/product-mapping/products/:id/accounts
 */
export const getProductAccounts = async (req: Request, res: Response) => {
  try {
    const accounts = await productMappingService.getAvailableAccountsForProduct(req.params.id, getProductFilter(req))
    res.json({ success: true, data: accounts })
  } catch (error: any) {
    logger.error('[ProductMapping] Get accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 手动添加账户关联
 * POST /api/product-mapping/products/:id/accounts
 */
export const addAccountToProduct = async (req: Request, res: Response) => {
  try {
    const { accountId, accountName, throughPixelId } = req.body
    const scopedAccount = await getScopedAccountAsset(req, accountId)
    
    const product = await Product.findOne(combineFilters({ _id: req.params.id }, getProductFilter(req)))
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }

    if (throughPixelId && !product.pixels.some((p: any) => p.pixelId === throughPixelId)) {
      return res.status(400).json({ success: false, error: 'Pixel not linked to this product' })
    }
    
    const existing = product.accounts.find((a: any) => normalizeForStorage(a.accountId) === scopedAccount.accountId)
    if (existing) {
      return res.status(400).json({ success: false, error: 'Account already linked to this product' })
    }
    
    product.accounts.push({
      accountId: scopedAccount.accountId,
      accountName: accountName || scopedAccount.accountName,
      throughPixelId,
      status: 'active',
    })
    
    await product.save()
    
    res.json({ success: true, data: product })
  } catch (error: any) {
    logger.error('[ProductMapping] Add account failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

// ==================== 自动化操作 ====================

/**
 * 从文案包扫描产品
 * POST /api/product-mapping/scan-products
 */
export const scanProducts = async (req: Request, res: Response) => {
  try {
    const result = await productMappingService.scanProductsFromCopyPackages(getProductFilter(req), getOwnerData(req))
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[ProductMapping] Scan products failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 自动匹配 Pixels
 * POST /api/product-mapping/match-pixels
 */
export const matchPixels = async (req: Request, res: Response) => {
  try {
    const minConfidence = parseInt(req.query.minConfidence as string) || 50
    const result = await productMappingService.matchProductsWithPixels(
      minConfidence,
      getProductFilter(req),
      getProductFilter(req),
      scopedTokenFilter(req),
    )
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[ProductMapping] Match pixels failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 发现可用账户
 * POST /api/product-mapping/discover-accounts
 */
export const discoverAccounts = async (req: Request, res: Response) => {
  try {
    const result = await productMappingService.discoverAccountsByPixels(
      getProductFilter(req),
      getProductFilter(req),
      scopedTokenFilter(req),
    )
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[ProductMapping] Discover accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 完整同步（一键执行所有步骤）
 * POST /api/product-mapping/sync-all
 */
export const syncAll = async (req: Request, res: Response) => {
  try {
    const result = await productMappingService.syncAllProductMappings(
      getProductFilter(req),
      getOwnerData(req),
      getProductFilter(req),
      scopedTokenFilter(req),
    )
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[ProductMapping] Sync all failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 查询接口 ====================

/**
 * 通过 URL 查找产品
 * GET /api/product-mapping/find-by-url
 */
export const findByUrl = async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string
    if (!url) {
      return res.status(400).json({ success: false, error: 'url parameter is required' })
    }
    
    const product = await productMappingService.findProductByUrl(url, getProductFilter(req))
    
    res.json({
      success: true,
      data: product,
      found: !!product,
    })
  } catch (error: any) {
    logger.error('[ProductMapping] Find by URL failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 为投放选择最佳账户
 * GET /api/product-mapping/products/:id/best-account
 */
export const getBestAccount = async (req: Request, res: Response) => {
  try {
    const result = await productMappingService.selectBestAccountForProduct(req.params.id, getProductFilter(req))
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'No available account found for this product',
      })
    }
    
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[ProductMapping] Get best account failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 解析 URL 预览（不创建产品）
 * GET /api/product-mapping/parse-url
 */
export const parseUrl = async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string
    if (!url) {
      return res.status(400).json({ success: false, error: 'url parameter is required' })
    }
    
    const parsed = productMappingService.parseProductUrl(url)
    
    res.json({
      success: true,
      data: parsed,
    })
  } catch (error: any) {
    logger.error('[ProductMapping] Parse URL failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取关系统计
 * GET /api/product-mapping/stats
 */
export const getStats = async (req: Request, res: Response) => {
  try {
    const scope = getProductFilter(req)
    const totalProducts = await Product.countDocuments(scope)
    const productsWithPixel = await Product.countDocuments(combineFilters(scope, { 'pixels.0': { $exists: true } }))
    const productsWithAccount = await Product.countDocuments(combineFilters(scope, { 'accounts.0': { $exists: true } }))
    const fullyConfigured = await Product.countDocuments(combineFilters(scope, {
      'pixels.0': { $exists: true },
      'accounts.0': { $exists: true },
    }))
    
    res.json({
      success: true,
      data: {
        totalProducts,
        productsWithPixel,
        productsWithAccount,
        fullyConfigured,
        automationReady: fullyConfigured, // 可以自动投放的产品数
      },
    })
  } catch (error: any) {
    logger.error('[ProductMapping] Get stats failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
