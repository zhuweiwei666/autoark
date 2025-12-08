"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStats = exports.parseUrl = exports.getBestAccount = exports.findByUrl = exports.syncAll = exports.discoverAccounts = exports.matchPixels = exports.scanProducts = exports.addAccountToProduct = exports.getProductAccounts = exports.setPrimaryPixel = exports.removePixelFromProduct = exports.addPixelToProduct = exports.updateProduct = exports.createProduct = exports.getProductById = exports.getProducts = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const Product_1 = __importDefault(require("../models/Product"));
const productMappingService = __importStar(require("../services/productMapping.service"));
/**
 * 产品映射控制器
 * 提供产品关系管理的 API 接口
 */
// ==================== 产品 CRUD ====================
/**
 * 获取所有产品
 * GET /api/product-mapping/products
 */
const getProducts = async (req, res) => {
    try {
        const { status, hasPixel, hasAccount, search } = req.query;
        const query = {};
        if (status)
            query.status = status;
        if (hasPixel === 'true')
            query['pixels.0'] = { $exists: true };
        if (hasPixel === 'false')
            query['pixels.0'] = { $exists: false };
        if (hasAccount === 'true')
            query['accounts.0'] = { $exists: true };
        if (hasAccount === 'false')
            query['accounts.0'] = { $exists: false };
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { identifier: { $regex: search, $options: 'i' } },
                { primaryDomain: { $regex: search, $options: 'i' } },
            ];
        }
        const products = await Product_1.default.find(query)
            .sort({ updatedAt: -1 })
            .populate('copywritingPackageIds', 'name');
        res.json({
            success: true,
            data: products,
            total: products.length,
        });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Get products failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getProducts = getProducts;
/**
 * 获取单个产品详情
 * GET /api/product-mapping/products/:id
 */
const getProductById = async (req, res) => {
    try {
        const product = await Product_1.default.findById(req.params.id)
            .populate('copywritingPackageIds', 'name links');
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        res.json({ success: true, data: product });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Get product failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getProductById = getProductById;
/**
 * 创建产品
 * POST /api/product-mapping/products
 */
const createProduct = async (req, res) => {
    try {
        const { name, identifier, primaryDomain, description, tags, category } = req.body;
        if (!name || !identifier) {
            return res.status(400).json({ success: false, error: 'name and identifier are required' });
        }
        const existing = await Product_1.default.findOne({ identifier });
        if (existing) {
            return res.status(400).json({ success: false, error: 'Product with this identifier already exists' });
        }
        const product = await Product_1.default.create({
            name,
            identifier,
            primaryDomain,
            description,
            tags,
            category,
        });
        res.json({ success: true, data: product });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Create product failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.createProduct = createProduct;
/**
 * 更新产品
 * PUT /api/product-mapping/products/:id
 */
const updateProduct = async (req, res) => {
    try {
        const product = await Product_1.default.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        res.json({ success: true, data: product });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Update product failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.updateProduct = updateProduct;
// ==================== Pixel 管理 ====================
/**
 * 手动添加 Pixel 关联
 * POST /api/product-mapping/products/:id/pixels
 */
const addPixelToProduct = async (req, res) => {
    try {
        const { pixelId, pixelName, verified } = req.body;
        if (!pixelId) {
            return res.status(400).json({ success: false, error: 'pixelId is required' });
        }
        const product = await Product_1.default.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        // 检查是否已存在
        const existing = product.pixels.find((p) => p.pixelId === pixelId);
        if (existing) {
            return res.status(400).json({ success: false, error: 'Pixel already linked to this product' });
        }
        product.pixels.push({
            pixelId,
            pixelName,
            confidence: 100,
            matchMethod: 'manual',
            verified: verified !== false,
            verifiedAt: new Date(),
        });
        // 设为主 Pixel（如果是第一个）
        if (!product.primaryPixelId) {
            product.primaryPixelId = pixelId;
        }
        await product.save();
        res.json({ success: true, data: product });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Add pixel failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.addPixelToProduct = addPixelToProduct;
/**
 * 移除 Pixel 关联
 * DELETE /api/product-mapping/products/:id/pixels/:pixelId
 */
const removePixelFromProduct = async (req, res) => {
    try {
        const product = await Product_1.default.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        // 使用 $pull 操作或类型转换来避免类型错误
        const filteredPixels = product.pixels.filter((p) => p.pixelId !== req.params.pixelId);
        product.set('pixels', filteredPixels);
        // 如果删除的是主 Pixel，重新设置
        if (product.primaryPixelId === req.params.pixelId) {
            product.primaryPixelId = product.pixels[0]?.pixelId || null;
        }
        await product.save();
        res.json({ success: true, data: product });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Remove pixel failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.removePixelFromProduct = removePixelFromProduct;
/**
 * 设置主 Pixel
 * PUT /api/product-mapping/products/:id/primary-pixel
 */
const setPrimaryPixel = async (req, res) => {
    try {
        const { pixelId } = req.body;
        const product = await Product_1.default.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        const pixelExists = product.pixels.find((p) => p.pixelId === pixelId);
        if (!pixelExists) {
            return res.status(400).json({ success: false, error: 'Pixel not linked to this product' });
        }
        product.primaryPixelId = pixelId;
        await product.save();
        res.json({ success: true, data: product });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Set primary pixel failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.setPrimaryPixel = setPrimaryPixel;
// ==================== 账户管理 ====================
/**
 * 获取产品的可用投放账户
 * GET /api/product-mapping/products/:id/accounts
 */
const getProductAccounts = async (req, res) => {
    try {
        const accounts = await productMappingService.getAvailableAccountsForProduct(req.params.id);
        res.json({ success: true, data: accounts });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Get accounts failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getProductAccounts = getProductAccounts;
/**
 * 手动添加账户关联
 * POST /api/product-mapping/products/:id/accounts
 */
const addAccountToProduct = async (req, res) => {
    try {
        const { accountId, accountName, throughPixelId } = req.body;
        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }
        const product = await Product_1.default.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        const existing = product.accounts.find((a) => a.accountId === accountId);
        if (existing) {
            return res.status(400).json({ success: false, error: 'Account already linked to this product' });
        }
        product.accounts.push({
            accountId,
            accountName,
            throughPixelId,
            status: 'active',
        });
        await product.save();
        res.json({ success: true, data: product });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Add account failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.addAccountToProduct = addAccountToProduct;
// ==================== 自动化操作 ====================
/**
 * 从文案包扫描产品
 * POST /api/product-mapping/scan-products
 */
const scanProducts = async (req, res) => {
    try {
        const result = await productMappingService.scanProductsFromCopyPackages();
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Scan products failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.scanProducts = scanProducts;
/**
 * 自动匹配 Pixels
 * POST /api/product-mapping/match-pixels
 */
const matchPixels = async (req, res) => {
    try {
        const minConfidence = parseInt(req.query.minConfidence) || 50;
        const result = await productMappingService.matchProductsWithPixels(minConfidence);
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Match pixels failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.matchPixels = matchPixels;
/**
 * 发现可用账户
 * POST /api/product-mapping/discover-accounts
 */
const discoverAccounts = async (req, res) => {
    try {
        const result = await productMappingService.discoverAccountsByPixels();
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Discover accounts failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.discoverAccounts = discoverAccounts;
/**
 * 完整同步（一键执行所有步骤）
 * POST /api/product-mapping/sync-all
 */
const syncAll = async (req, res) => {
    try {
        const result = await productMappingService.syncAllProductMappings();
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Sync all failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.syncAll = syncAll;
// ==================== 查询接口 ====================
/**
 * 通过 URL 查找产品
 * GET /api/product-mapping/find-by-url
 */
const findByUrl = async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) {
            return res.status(400).json({ success: false, error: 'url parameter is required' });
        }
        const product = await productMappingService.findProductByUrl(url);
        res.json({
            success: true,
            data: product,
            found: !!product,
        });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Find by URL failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.findByUrl = findByUrl;
/**
 * 为投放选择最佳账户
 * GET /api/product-mapping/products/:id/best-account
 */
const getBestAccount = async (req, res) => {
    try {
        const result = await productMappingService.selectBestAccountForProduct(req.params.id);
        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'No available account found for this product',
            });
        }
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Get best account failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getBestAccount = getBestAccount;
/**
 * 解析 URL 预览（不创建产品）
 * GET /api/product-mapping/parse-url
 */
const parseUrl = async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) {
            return res.status(400).json({ success: false, error: 'url parameter is required' });
        }
        const parsed = productMappingService.parseProductUrl(url);
        res.json({
            success: true,
            data: parsed,
        });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Parse URL failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.parseUrl = parseUrl;
/**
 * 获取关系统计
 * GET /api/product-mapping/stats
 */
const getStats = async (req, res) => {
    try {
        const totalProducts = await Product_1.default.countDocuments();
        const productsWithPixel = await Product_1.default.countDocuments({ 'pixels.0': { $exists: true } });
        const productsWithAccount = await Product_1.default.countDocuments({ 'accounts.0': { $exists: true } });
        const fullyConfigured = await Product_1.default.countDocuments({
            'pixels.0': { $exists: true },
            'accounts.0': { $exists: true },
        });
        res.json({
            success: true,
            data: {
                totalProducts,
                productsWithPixel,
                productsWithAccount,
                fullyConfigured,
                automationReady: fullyConfigured, // 可以自动投放的产品数
            },
        });
    }
    catch (error) {
        logger_1.default.error('[ProductMapping] Get stats failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getStats = getStats;
