import { Request, Response } from 'express'
import logger from '../utils/logger'
import Product from '../models/Product'
import * as productMappingService from '../services/productMapping.service'

/**
 * 产品映射控制器
 * 提供产品关系管理的 API 接口
 */

// ==================== 产品 CRUD ====================

/**
 * 获取所有产品
 * GET /api/product-mapping/products
 */
export const getProducts = async (req: Request, res: Response) => {
  try {
    const { status, hasPixel, hasAccount, search } = req.query
    const query: any = {}
    
    if (status) query.status = status
    if (hasPixel === 'true') query['pixels.0'] = { $exists: true }
    if (hasPixel === 'false') query['pixels.0'] = { $exists: false }
    if (hasAccount === 'true') query['accounts.0'] = { $exists: true }
    if (hasAccount === 'false') query['accounts.0'] = { $exists: false }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { identifier: { $regex: search, $options: 'i' } },
        { primaryDomain: { $regex: search, $options: 'i' } },
      ]
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
    const product = await Product.findById(req.params.id)
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
    
    const existing = await Product.findOne({ identifier })
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
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
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
    
    if (!pixelId) {
      return res.status(400).json({ success: false, error: 'pixelId is required' })
    }
    
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    
    // 检查是否已存在
    const existing = product.pixels.find((p: any) => p.pixelId === pixelId)
    if (existing) {
      return res.status(400).json({ success: false, error: 'Pixel already linked to this product' })
    }
    
    product.pixels.push({
      pixelId,
      pixelName,
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
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 移除 Pixel 关联
 * DELETE /api/product-mapping/products/:id/pixels/:pixelId
 */
export const removePixelFromProduct = async (req: Request, res: Response) => {
  try {
    const product = await Product.findById(req.params.id)
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
    
    const product = await Product.findById(req.params.id)
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
    const accounts = await productMappingService.getAvailableAccountsForProduct(req.params.id)
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
    
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' })
    }
    
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    
    const existing = product.accounts.find((a: any) => a.accountId === accountId)
    if (existing) {
      return res.status(400).json({ success: false, error: 'Account already linked to this product' })
    }
    
    product.accounts.push({
      accountId,
      accountName,
      throughPixelId,
      status: 'active',
    })
    
    await product.save()
    
    res.json({ success: true, data: product })
  } catch (error: any) {
    logger.error('[ProductMapping] Add account failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 自动化操作 ====================

/**
 * 从文案包扫描产品
 * POST /api/product-mapping/scan-products
 */
export const scanProducts = async (req: Request, res: Response) => {
  try {
    const result = await productMappingService.scanProductsFromCopyPackages()
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
    const result = await productMappingService.matchProductsWithPixels(minConfidence)
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
    const result = await productMappingService.discoverAccountsByPixels()
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
    const result = await productMappingService.syncAllProductMappings()
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
    
    const product = await productMappingService.findProductByUrl(url)
    
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
    const result = await productMappingService.selectBestAccountForProduct(req.params.id)
    
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
    const totalProducts = await Product.countDocuments()
    const productsWithPixel = await Product.countDocuments({ 'pixels.0': { $exists: true } })
    const productsWithAccount = await Product.countDocuments({ 'accounts.0': { $exists: true } })
    const fullyConfigured = await Product.countDocuments({
      'pixels.0': { $exists: true },
      'accounts.0': { $exists: true },
    })
    
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

