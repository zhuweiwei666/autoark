"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProductUrl = parseProductUrl;
exports.scanProductsFromCopyPackages = scanProductsFromCopyPackages;
exports.fetchAllPixels = fetchAllPixels;
exports.matchProductsWithPixels = matchProductsWithPixels;
exports.discoverAccountsByPixels = discoverAccountsByPixels;
exports.findProductByUrl = findProductByUrl;
exports.getAvailableAccountsForProduct = getAvailableAccountsForProduct;
exports.selectBestAccountForProduct = selectBestAccountForProduct;
exports.syncAllProductMappings = syncAllProductMappings;
const logger_1 = __importDefault(require("../utils/logger"));
const Product_1 = __importDefault(require("../models/Product"));
const CopywritingPackage_1 = __importDefault(require("../models/CopywritingPackage"));
const FbToken_1 = __importDefault(require("../models/FbToken"));
const Account_1 = __importDefault(require("../models/Account"));
const facebookClient_1 = require("../integration/facebook/facebookClient");
const url_1 = require("url");
/**
 * 从 URL 解析产品信息
 * 支持多种 URL 格式：
 * - https://example.com/products/iphone-15
 * - https://shop.example.com/?product=iphone15
 * - https://example.com/p/12345
 */
function parseProductUrl(urlString) {
    try {
        const url = new url_1.URL(urlString);
        const domain = url.hostname.replace(/^www\./, '');
        const path = url.pathname;
        // 尝试从路径中提取产品标识
        let productIdentifier = '';
        let productName = '';
        // 模式1: /products/{slug} 或 /p/{id}
        const pathPatterns = [
            /\/products?\/([^\/\?]+)/i,
            /\/p\/([^\/\?]+)/i,
            /\/item\/([^\/\?]+)/i,
            /\/goods\/([^\/\?]+)/i,
            /\/shop\/([^\/\?]+)/i,
        ];
        for (const pattern of pathPatterns) {
            const match = path.match(pattern);
            if (match) {
                productIdentifier = match[1];
                productName = formatProductName(productIdentifier);
                break;
            }
        }
        // 模式2: 从查询参数提取
        if (!productIdentifier) {
            const paramNames = ['product', 'item', 'id', 'sku', 'pid'];
            for (const param of paramNames) {
                const value = url.searchParams.get(param);
                if (value) {
                    productIdentifier = value;
                    productName = formatProductName(value);
                    break;
                }
            }
        }
        // 如果仍然没有找到，使用域名作为标识符
        if (!productIdentifier) {
            productIdentifier = domain;
            productName = domain.split('.')[0];
        }
        return {
            domain,
            path,
            productIdentifier: `${domain}:${productIdentifier}`.toLowerCase(),
            productName: productName || productIdentifier,
        };
    }
    catch (error) {
        logger_1.default.warn(`[ProductMapping] Failed to parse URL: ${urlString}`, error);
        return null;
    }
}
/**
 * 格式化产品名称（slug -> 可读名称）
 */
function formatProductName(slug) {
    return slug
        .replace(/[-_]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .trim();
}
// ==================== 产品扫描与创建 ====================
/**
 * 从所有文案包扫描并创建产品
 */
async function scanProductsFromCopyPackages() {
    const result = { created: 0, updated: 0, errors: [] };
    try {
        const packages = await CopywritingPackage_1.default.find({
            'links.websiteUrl': { $exists: true, $ne: '' }
        });
        logger_1.default.info(`[ProductMapping] Scanning ${packages.length} copy packages for products`);
        for (const pkg of packages) {
            try {
                const urlString = pkg.links?.websiteUrl;
                if (!urlString)
                    continue;
                const parsed = parseProductUrl(urlString);
                if (!parsed)
                    continue;
                // 查找或创建产品
                let product = await Product_1.default.findOne({ identifier: parsed.productIdentifier });
                if (product) {
                    // 更新：添加文案包引用
                    if (!product.copywritingPackageIds.includes(pkg._id)) {
                        product.copywritingPackageIds.push(pkg._id);
                        await product.save();
                        result.updated++;
                    }
                }
                else {
                    // 创建新产品
                    product = await Product_1.default.create({
                        name: parsed.productName,
                        identifier: parsed.productIdentifier,
                        primaryDomain: parsed.domain,
                        urlPatterns: [{
                                pattern: parsed.domain,
                                type: 'domain',
                                priority: 1,
                            }],
                        copywritingPackageIds: [pkg._id],
                    });
                    result.created++;
                    logger_1.default.info(`[ProductMapping] Created product: ${parsed.productName} (${parsed.productIdentifier})`);
                }
            }
            catch (error) {
                result.errors.push(`Package ${pkg._id}: ${error.message}`);
            }
        }
        logger_1.default.info(`[ProductMapping] Scan complete: ${result.created} created, ${result.updated} updated`);
        return result;
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Scan failed:', error);
        throw error;
    }
}
/**
 * 从所有授权账户获取 Pixels
 */
async function fetchAllPixels() {
    const allPixels = [];
    try {
        // 获取所有活跃账户
        const accounts = await Account_1.default.find({ status: { $ne: 'disabled' } });
        // 获取有效 Token
        const fbToken = await FbToken_1.default.findOne({ status: 'active' }).sort({ updatedAt: -1 });
        if (!fbToken) {
            logger_1.default.warn('[ProductMapping] No active Facebook token found');
            return [];
        }
        for (const account of accounts) {
            try {
                const accountId = account.accountId.replace('act_', '');
                const result = await facebookClient_1.facebookClient.get(`/act_${accountId}/adspixels`, {
                    access_token: fbToken.token,
                    fields: 'id,name',
                    limit: 100,
                });
                const pixels = result.data || [];
                for (const pixel of pixels) {
                    allPixels.push({
                        id: pixel.id,
                        name: pixel.name || 'Unnamed Pixel',
                        accountId: account.accountId,
                        accountName: account.name,
                    });
                }
            }
            catch (error) {
                logger_1.default.warn(`[ProductMapping] Failed to fetch pixels for account ${account.accountId}: ${error.message}`);
            }
        }
        logger_1.default.info(`[ProductMapping] Fetched ${allPixels.length} pixels from ${accounts.length} accounts`);
        return allPixels;
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Failed to fetch pixels:', error);
        return [];
    }
}
/**
 * 计算产品名称与 Pixel 名称的相似度
 */
function calculateSimilarity(str1, str2) {
    const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s1 === s2)
        return 100;
    if (s1.includes(s2) || s2.includes(s1))
        return 80;
    // Levenshtein 距离
    const matrix = [];
    for (let i = 0; i <= s1.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= s2.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= s1.length; i++) {
        for (let j = 1; j <= s2.length; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0)
        return 100;
    const distance = matrix[s1.length][s2.length];
    return Math.round((1 - distance / maxLen) * 100);
}
/**
 * 为所有产品匹配 Pixels
 */
async function matchProductsWithPixels(minConfidence = 50) {
    const result = { matched: 0, unmatched: 0, details: [] };
    try {
        const products = await Product_1.default.find({ status: 'active' });
        const pixels = await fetchAllPixels();
        logger_1.default.info(`[ProductMapping] Matching ${products.length} products with ${pixels.length} pixels`);
        for (const product of products) {
            let bestMatch = null;
            // 尝试匹配每个 Pixel
            for (const pixel of pixels) {
                // 计算相似度
                const nameConfidence = calculateSimilarity(product.name, pixel.name);
                const domainInName = pixel.name.toLowerCase().includes(product.primaryDomain?.split('.')[0] || '');
                const confidence = domainInName ? Math.max(nameConfidence, 70) : nameConfidence;
                if (confidence >= minConfidence && (!bestMatch || confidence > bestMatch.confidence)) {
                    bestMatch = { pixel, confidence };
                }
            }
            if (bestMatch) {
                // 更新产品的 Pixel 关联
                const existingPixel = product.pixels.find((p) => p.pixelId === bestMatch.pixel.id);
                if (!existingPixel) {
                    product.pixels.push({
                        pixelId: bestMatch.pixel.id,
                        pixelName: bestMatch.pixel.name,
                        confidence: bestMatch.confidence,
                        matchMethod: 'auto_name',
                        verified: false,
                    });
                    // 同时添加账户关联
                    const existingAccount = product.accounts.find((a) => a.accountId === bestMatch.pixel.accountId);
                    if (!existingAccount) {
                        product.accounts.push({
                            accountId: bestMatch.pixel.accountId,
                            accountName: bestMatch.pixel.accountName,
                            throughPixelId: bestMatch.pixel.id,
                            status: 'active',
                        });
                    }
                    // 设置主 Pixel（如果没有）
                    if (!product.primaryPixelId) {
                        product.primaryPixelId = bestMatch.pixel.id;
                    }
                    await product.save();
                }
                result.matched++;
                result.details.push({
                    productId: product._id,
                    productName: product.name,
                    pixelId: bestMatch.pixel.id,
                    pixelName: bestMatch.pixel.name,
                    confidence: bestMatch.confidence,
                });
            }
            else {
                result.unmatched++;
                result.details.push({
                    productId: product._id,
                    productName: product.name,
                    confidence: 0,
                });
            }
        }
        logger_1.default.info(`[ProductMapping] Matching complete: ${result.matched} matched, ${result.unmatched} unmatched`);
        return result;
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Matching failed:', error);
        throw error;
    }
}
// ==================== 通过 Pixel 发现账户 ====================
/**
 * 扫描所有账户，建立 Pixel-账户 关系
 */
async function discoverAccountsByPixels() {
    const result = { productsUpdated: 0, newAccountMappings: 0 };
    try {
        const products = await Product_1.default.find({
            status: 'active',
            'pixels.0': { $exists: true } // 至少有一个 Pixel
        });
        const accounts = await Account_1.default.find({ status: { $ne: 'disabled' } });
        const fbToken = await FbToken_1.default.findOne({ status: 'active' }).sort({ updatedAt: -1 });
        if (!fbToken) {
            logger_1.default.warn('[ProductMapping] No active Facebook token found');
            return result;
        }
        // 建立 Pixel -> Accounts 的映射
        const pixelToAccounts = new Map();
        for (const account of accounts) {
            try {
                const accountId = account.accountId.replace('act_', '');
                const pixelsResult = await facebookClient_1.facebookClient.get(`/act_${accountId}/adspixels`, {
                    access_token: fbToken.token,
                    fields: 'id',
                    limit: 100,
                });
                const pixels = pixelsResult.data || [];
                for (const pixel of pixels) {
                    const existing = pixelToAccounts.get(pixel.id) || [];
                    existing.push({ accountId: account.accountId, accountName: account.name });
                    pixelToAccounts.set(pixel.id, existing);
                }
            }
            catch (error) {
                // 跳过失败的账户
            }
        }
        // 更新产品的账户关联
        for (const product of products) {
            let updated = false;
            for (const pixelMapping of product.pixels) {
                const accountsForPixel = pixelToAccounts.get(pixelMapping.pixelId) || [];
                for (const acct of accountsForPixel) {
                    const existing = product.accounts.find((a) => a.accountId === acct.accountId);
                    if (!existing) {
                        product.accounts.push({
                            accountId: acct.accountId,
                            accountName: acct.accountName,
                            throughPixelId: pixelMapping.pixelId,
                            status: 'active',
                        });
                        result.newAccountMappings++;
                        updated = true;
                    }
                }
            }
            if (updated) {
                await product.save();
                result.productsUpdated++;
            }
        }
        logger_1.default.info(`[ProductMapping] Account discovery complete: ${result.productsUpdated} products updated, ${result.newAccountMappings} new account mappings`);
        return result;
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Account discovery failed:', error);
        throw error;
    }
}
// ==================== 查询接口 ====================
/**
 * 通过 URL 查找匹配的产品
 */
async function findProductByUrl(urlString) {
    const parsed = parseProductUrl(urlString);
    if (!parsed)
        return null;
    // 精确匹配
    let product = await Product_1.default.findOne({ identifier: parsed.productIdentifier });
    if (product)
        return product;
    // 域名匹配
    product = await Product_1.default.findOne({ primaryDomain: parsed.domain });
    return product;
}
/**
 * 获取产品的可用投放账户
 */
async function getAvailableAccountsForProduct(productId) {
    const product = await Product_1.default.findById(productId);
    if (!product)
        return [];
    return product.accounts
        .filter((a) => a.status === 'active')
        .map((a) => {
        const pixel = product.pixels.find((p) => p.pixelId === a.throughPixelId);
        return {
            accountId: a.accountId,
            accountName: a.accountName,
            pixelId: a.throughPixelId,
            pixelName: pixel?.pixelName,
        };
    });
}
/**
 * 为自动投放选择最佳账户和 Pixel
 */
async function selectBestAccountForProduct(productId) {
    const product = await Product_1.default.findById(productId);
    if (!product)
        return null;
    // 获取主 Pixel
    const primaryPixel = product.getPrimaryPixel();
    if (!primaryPixel)
        return null;
    // 获取最佳账户
    const accountId = product.getBestAccount();
    if (!accountId)
        return null;
    return {
        accountId,
        pixelId: primaryPixel.pixelId,
        pixelName: primaryPixel.pixelName,
    };
}
/**
 * 完整的产品关系同步（一键执行所有步骤）
 */
async function syncAllProductMappings() {
    logger_1.default.info('[ProductMapping] Starting full sync...');
    // 步骤1: 从文案包扫描产品
    const productResult = await scanProductsFromCopyPackages();
    // 步骤2: 匹配 Pixels
    const pixelResult = await matchProductsWithPixels();
    // 步骤3: 发现账户
    const accountResult = await discoverAccountsByPixels();
    logger_1.default.info('[ProductMapping] Full sync complete!');
    return {
        products: { created: productResult.created, updated: productResult.updated },
        pixelMatches: { matched: pixelResult.matched, unmatched: pixelResult.unmatched },
        accountDiscovery: accountResult,
    };
}
