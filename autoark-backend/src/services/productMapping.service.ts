import logger from '../utils/logger'
import Product from '../models/Product'
import CopywritingPackage from '../models/CopywritingPackage'
import FbToken from '../models/FbToken'
import Account from '../models/Account'
import { facebookClient } from '../integration/facebook/facebookClient'
import { URL } from 'url'
import { combineFilters } from '../utils/accessControl'
import { normalizeForStorage } from '../utils/accountId'

const PRODUCT_MAPPING_FACEBOOK_PAGE_LIMIT = 10
const PRODUCT_MAPPING_FACEBOOK_PAGE_SIZE = 100

/**
 * 产品映射服务
 * 实现文案包 → 产品 → Pixel → 账户的关系映射
 */

// ==================== URL 解析 ====================

interface UrlParseResult {
  domain: string
  path: string
  productIdentifier: string
  productName?: string
}

/**
 * 从 URL 解析产品信息
 * 支持多种 URL 格式：
 * - https://example.com/products/iphone-15
 * - https://shop.example.com/?product=iphone15
 * - https://example.com/p/12345
 */
export function parseProductUrl(urlString: string): UrlParseResult | null {
  try {
    const url = new URL(urlString)
    const domain = url.hostname.replace(/^www\./, '')
    const path = url.pathname
    
    // 尝试从路径中提取产品标识
    let productIdentifier = ''
    let productName = ''
    
    // 模式1: /products/{slug} 或 /p/{id}
    const pathPatterns = [
      /\/products?\/([^\/\?]+)/i,
      /\/p\/([^\/\?]+)/i,
      /\/item\/([^\/\?]+)/i,
      /\/goods\/([^\/\?]+)/i,
      /\/shop\/([^\/\?]+)/i,
    ]
    
    for (const pattern of pathPatterns) {
      const match = path.match(pattern)
      if (match) {
        productIdentifier = match[1]
        productName = formatProductName(productIdentifier)
        break
      }
    }
    
    // 模式2: 从查询参数提取
    if (!productIdentifier) {
      const paramNames = ['product', 'item', 'id', 'sku', 'pid']
      for (const param of paramNames) {
        const value = url.searchParams.get(param)
        if (value) {
          productIdentifier = value
          productName = formatProductName(value)
          break
        }
      }
    }
    
    // 如果仍然没有找到，使用域名作为标识符
    if (!productIdentifier) {
      productIdentifier = domain
      productName = domain.split('.')[0]
    }
    
    return {
      domain,
      path,
      productIdentifier: `${domain}:${productIdentifier}`.toLowerCase(),
      productName: productName || productIdentifier,
    }
  } catch (error) {
    logger.warn(`[ProductMapping] Failed to parse URL: ${urlString}`, error)
    return null
  }
}

/**
 * 格式化产品名称（slug -> 可读名称）
 */
function formatProductName(slug: string): string {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim()
}

// ==================== 产品扫描与创建 ====================

/**
 * 从所有文案包扫描并创建产品
 */
export async function scanProductsFromCopyPackages(accessFilter: any = {}, ownerData: any = {}): Promise<{
  created: number
  updated: number
  errors: string[]
}> {
  const result = { created: 0, updated: 0, errors: [] as string[] }
  
  try {
    const packages = await CopywritingPackage.find(combineFilters(accessFilter, {
      'links.websiteUrl': { $exists: true, $ne: '' }
    }))
    
    logger.info(`[ProductMapping] Scanning ${packages.length} copy packages for products`)
    
    for (const pkg of packages) {
      try {
        const urlString = (pkg as any).links?.websiteUrl
        if (!urlString) continue
        
        const parsed = parseProductUrl(urlString)
        if (!parsed) continue
        
        // 查找或创建产品
        let product = await Product.findOne(combineFilters({ identifier: parsed.productIdentifier }, accessFilter))
        
        if (product) {
          // 更新：添加文案包引用
          if (!product.copywritingPackageIds.includes(pkg._id)) {
            product.copywritingPackageIds.push(pkg._id)
            await product.save()
            result.updated++
          }
        } else {
          // 创建新产品
          product = await Product.create({
            name: parsed.productName,
            identifier: parsed.productIdentifier,
            ...ownerData,
            primaryDomain: parsed.domain,
            urlPatterns: [{
              pattern: parsed.domain,
              type: 'domain',
              priority: 1,
            }],
            copywritingPackageIds: [pkg._id],
          })
          result.created++
          logger.info(`[ProductMapping] Created product: ${parsed.productName} (${parsed.productIdentifier})`)
        }
      } catch (error: any) {
        result.errors.push(`Package ${pkg._id}: ${error.message}`)
      }
    }
    
    logger.info(`[ProductMapping] Scan complete: ${result.created} created, ${result.updated} updated`)
    return result
  } catch (error: any) {
    logger.error('[ProductMapping] Scan failed:', error)
    throw error
  }
}

// ==================== Pixel 匹配 ====================

interface PixelInfo {
  id: string
  name: string
  accountId: string
  accountName?: string
}

const getScopedTokenForAccount = async (account: any, tokens: any[]) => {
  const accountId = normalizeForStorage(account.accountId)
  if (!accountId || tokens.length === 0) return null

  if (account.token) {
    const directlyLinkedToken = tokens.find(token => token.token === account.token)
    if (directlyLinkedToken) {
      return directlyLinkedToken
    }
  }

  for (const token of tokens) {
    try {
      const result = await facebookClient.get(`/act_${accountId}`, {
        access_token: token.token,
        fields: 'id,name',
      })
      if (result?.id) {
        return token
      }
    } catch (error: any) {
      logger.debug(`[ProductMapping] Token ${token.fbUserName || token._id} cannot access account ${accountId}`)
    }
  }

  return null
}

const fetchAccountPixelsFromFacebook = async (
  accountId: string,
  accessToken: string,
  fields: string,
) => {
  const pixels: any[] = []
  let after: string | undefined
  let pageCount = 0

  while (pageCount < PRODUCT_MAPPING_FACEBOOK_PAGE_LIMIT) {
    const result = await facebookClient.get(`/act_${accountId}/adspixels`, {
      access_token: accessToken,
      fields,
      limit: PRODUCT_MAPPING_FACEBOOK_PAGE_SIZE,
      ...(after && { after }),
    })

    pixels.push(...(result.data || []))
    pageCount += 1

    after = result.paging?.cursors?.after
    if (!after || !result.paging?.next) {
      break
    }
  }

  return pixels
}

/**
 * 从所有授权账户获取 Pixels
 */
export async function fetchAllPixels(accountFilter: any = {}, tokenFilter: any = {}): Promise<PixelInfo[]> {
  const allPixels: PixelInfo[] = []
  
  try {
    // 获取所有活跃账户
    const accounts = await Account.find(combineFilters({
      channel: 'facebook',
      status: { $ne: 'disabled' },
    }, accountFilter))
    
    // 获取有效 Token
    const fbTokens: any[] = await FbToken.find({ status: 'active', ...tokenFilter })
    if (fbTokens.length === 0) {
      logger.warn('[ProductMapping] No active Facebook token found')
      return []
    }
    
    for (const account of accounts) {
      try {
        const accountId = normalizeForStorage(account.accountId)
        const fbToken = await getScopedTokenForAccount(account, fbTokens)
        if (!fbToken) {
          logger.warn(`[ProductMapping] No scoped Facebook token can access account ${accountId}`)
          continue
        }
        const pixels = await fetchAccountPixelsFromFacebook(accountId, fbToken.token, 'id,name')
        for (const pixel of pixels) {
          allPixels.push({
            id: pixel.id,
            name: pixel.name || 'Unnamed Pixel',
            accountId,
            accountName: account.name,
          })
        }
      } catch (error: any) {
        logger.warn(`[ProductMapping] Failed to fetch pixels for account ${account.accountId}: ${error.message}`)
      }
    }
    
    logger.info(`[ProductMapping] Fetched ${allPixels.length} pixels from ${accounts.length} accounts`)
    return allPixels
  } catch (error: any) {
    logger.error('[ProductMapping] Failed to fetch pixels:', error)
    return []
  }
}

/**
 * 计算产品名称与 Pixel 名称的相似度
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '')
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '')
  
  if (s1 === s2) return 100
  if (s1.includes(s2) || s2.includes(s1)) return 80
  
  // Levenshtein 距离
  const matrix: number[][] = []
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }
  
  const maxLen = Math.max(s1.length, s2.length)
  if (maxLen === 0) return 100
  
  const distance = matrix[s1.length][s2.length]
  return Math.round((1 - distance / maxLen) * 100)
}

/**
 * 为所有产品匹配 Pixels
 */
export async function matchProductsWithPixels(
  minConfidence: number = 50,
  accessFilter: any = {},
  accountFilter: any = {},
  tokenFilter: any = {},
): Promise<{
  matched: number
  unmatched: number
  details: Array<{ productId: string; productName: string; pixelId?: string; pixelName?: string; confidence: number }>
}> {
  const result = { matched: 0, unmatched: 0, details: [] as any[] }
  
  try {
    const products = await Product.find(combineFilters({ status: 'active' }, accessFilter))
    const pixels = await fetchAllPixels(accountFilter, tokenFilter)
    
    logger.info(`[ProductMapping] Matching ${products.length} products with ${pixels.length} pixels`)
    
    for (const product of products) {
      let bestMatch: { pixel: PixelInfo; confidence: number } | null = null
      
      // 尝试匹配每个 Pixel
      for (const pixel of pixels) {
        // 计算相似度
        const nameConfidence = calculateSimilarity(product.name, pixel.name)
        const domainInName = pixel.name.toLowerCase().includes(product.primaryDomain?.split('.')[0] || '')
        const confidence = domainInName ? Math.max(nameConfidence, 70) : nameConfidence
        
        if (confidence >= minConfidence && (!bestMatch || confidence > bestMatch.confidence)) {
          bestMatch = { pixel, confidence }
        }
      }
      
      if (bestMatch) {
        // 更新产品的 Pixel 关联
        const existingPixel = product.pixels.find((p: any) => p.pixelId === bestMatch!.pixel.id)
        
        if (!existingPixel) {
          product.pixels.push({
            pixelId: bestMatch.pixel.id,
            pixelName: bestMatch.pixel.name,
            confidence: bestMatch.confidence,
            matchMethod: 'auto_name',
            verified: false,
          })
          
          // 同时添加账户关联
          const existingAccount = product.accounts.find((a: any) => a.accountId === bestMatch!.pixel.accountId)
          if (!existingAccount) {
            product.accounts.push({
              accountId: bestMatch.pixel.accountId,
              accountName: bestMatch.pixel.accountName,
              throughPixelId: bestMatch.pixel.id,
              status: 'active',
            })
          }
          
          // 设置主 Pixel（如果没有）
          if (!product.primaryPixelId) {
            product.primaryPixelId = bestMatch.pixel.id
          }
          
          await product.save()
        }
        
        result.matched++
        result.details.push({
          productId: product._id,
          productName: product.name,
          pixelId: bestMatch.pixel.id,
          pixelName: bestMatch.pixel.name,
          confidence: bestMatch.confidence,
        })
      } else {
        result.unmatched++
        result.details.push({
          productId: product._id,
          productName: product.name,
          confidence: 0,
        })
      }
    }
    
    logger.info(`[ProductMapping] Matching complete: ${result.matched} matched, ${result.unmatched} unmatched`)
    return result
  } catch (error: any) {
    logger.error('[ProductMapping] Matching failed:', error)
    throw error
  }
}

// ==================== 通过 Pixel 发现账户 ====================

/**
 * 扫描所有账户，建立 Pixel-账户 关系
 */
export async function discoverAccountsByPixels(
  accessFilter: any = {},
  accountFilter: any = {},
  tokenFilter: any = {},
): Promise<{
  productsUpdated: number
  newAccountMappings: number
}> {
  const result = { productsUpdated: 0, newAccountMappings: 0 }
  
  try {
    const products = await Product.find(combineFilters({
      status: 'active',
      'pixels.0': { $exists: true } // 至少有一个 Pixel
    }, accessFilter))
    
    const accounts = await Account.find(combineFilters({
      channel: 'facebook',
      status: { $ne: 'disabled' },
    }, accountFilter))
    const fbTokens: any[] = await FbToken.find({ status: 'active', ...tokenFilter })
    
    if (fbTokens.length === 0) {
      logger.warn('[ProductMapping] No active Facebook token found')
      return result
    }
    
    // 建立 Pixel -> Accounts 的映射
    const pixelToAccounts = new Map<string, Array<{ accountId: string; accountName?: string }>>()
    
    for (const account of accounts) {
      try {
        const accountId = normalizeForStorage(account.accountId)
        const fbToken = await getScopedTokenForAccount(account, fbTokens)
        if (!fbToken) {
          logger.warn(`[ProductMapping] No scoped Facebook token can access account ${accountId}`)
          continue
        }
        const pixels = await fetchAccountPixelsFromFacebook(accountId, fbToken.token, 'id')
        for (const pixel of pixels) {
          const existing = pixelToAccounts.get(pixel.id) || []
          existing.push({ accountId, accountName: account.name })
          pixelToAccounts.set(pixel.id, existing)
        }
      } catch (error: any) {
        // 跳过失败的账户
      }
    }
    
    // 更新产品的账户关联
    for (const product of products) {
      let updated = false
      
      for (const pixelMapping of product.pixels) {
        const accountsForPixel = pixelToAccounts.get(pixelMapping.pixelId) || []
        
        for (const acct of accountsForPixel) {
          const existing = product.accounts.find((a: any) => a.accountId === acct.accountId)
          if (!existing) {
            product.accounts.push({
              accountId: acct.accountId,
              accountName: acct.accountName,
              throughPixelId: pixelMapping.pixelId,
              status: 'active',
            })
            result.newAccountMappings++
            updated = true
          }
        }
      }
      
      if (updated) {
        await product.save()
        result.productsUpdated++
      }
    }
    
    logger.info(`[ProductMapping] Account discovery complete: ${result.productsUpdated} products updated, ${result.newAccountMappings} new account mappings`)
    return result
  } catch (error: any) {
    logger.error('[ProductMapping] Account discovery failed:', error)
    throw error
  }
}

// ==================== 查询接口 ====================

/**
 * 通过 URL 查找匹配的产品
 */
export async function findProductByUrl(urlString: string, accessFilter: any = {}): Promise<any | null> {
  const parsed = parseProductUrl(urlString)
  if (!parsed) return null
  
  // 精确匹配
  let product = await Product.findOne(combineFilters({ identifier: parsed.productIdentifier }, accessFilter))
  if (product) return product
  
  // 域名匹配
  product = await Product.findOne(combineFilters({ primaryDomain: parsed.domain }, accessFilter))
  return product
}

/**
 * 获取产品的可用投放账户
 */
export async function getAvailableAccountsForProduct(productId: string, accessFilter: any = {}): Promise<Array<{
  accountId: string
  accountName?: string
  pixelId?: string
  pixelName?: string
}>> {
  const product = await Product.findOne(combineFilters({ _id: productId }, accessFilter))
  if (!product) return []
  
  return product.accounts
    .filter((a: any) => a.status === 'active')
    .map((a: any) => {
      const pixel = product.pixels.find((p: any) => p.pixelId === a.throughPixelId)
      return {
        accountId: a.accountId,
        accountName: a.accountName,
        pixelId: a.throughPixelId,
        pixelName: pixel?.pixelName,
      }
    })
}

/**
 * 为自动投放选择最佳账户和 Pixel
 */
export async function selectBestAccountForProduct(productId: string, accessFilter: any = {}): Promise<{
  accountId: string
  pixelId: string
  pixelName?: string
} | null> {
  const product = await Product.findOne(combineFilters({ _id: productId }, accessFilter))
  if (!product) return null
  
  // 获取主 Pixel
  const primaryPixel = (product as any).getPrimaryPixel()
  if (!primaryPixel) return null
  
  // 获取最佳账户
  const accountId = (product as any).getBestAccount()
  if (!accountId) return null
  
  return {
    accountId,
    pixelId: primaryPixel.pixelId,
    pixelName: primaryPixel.pixelName,
  }
}

/**
 * 完整的产品关系同步（一键执行所有步骤）
 */
export async function syncAllProductMappings(
  accessFilter: any = {},
  ownerData: any = {},
  accountFilter: any = {},
  tokenFilter: any = {},
): Promise<{
  products: { created: number; updated: number }
  pixelMatches: { matched: number; unmatched: number }
  accountDiscovery: { productsUpdated: number; newAccountMappings: number }
}> {
  logger.info('[ProductMapping] Starting full sync...')
  
  // 步骤1: 从文案包扫描产品
  const productResult = await scanProductsFromCopyPackages(accessFilter, ownerData)
  
  // 步骤2: 匹配 Pixels
  const pixelResult = await matchProductsWithPixels(50, accessFilter, accountFilter, tokenFilter)
  
  // 步骤3: 发现账户
  const accountResult = await discoverAccountsByPixels(accessFilter, accountFilter, tokenFilter)
  
  logger.info('[ProductMapping] Full sync complete!')
  
  return {
    products: { created: productResult.created, updated: productResult.updated },
    pixelMatches: { matched: pixelResult.matched, unmatched: pixelResult.unmatched },
    accountDiscovery: accountResult,
  }
}
