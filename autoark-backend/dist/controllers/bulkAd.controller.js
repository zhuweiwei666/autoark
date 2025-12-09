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
exports.refreshAdsReviewStatus = exports.getAdsReviewOverview = exports.checkTaskReviewStatus = exports.getTaskReviewStatus = exports.resyncFacebookAssets = exports.getPixelSyncStatus = exports.getCachedPixels = exports.getAuthPixels = exports.getAuthPages = exports.getAuthAdAccounts = exports.getAuthStatus = exports.handleAuthCallback = exports.getAuthLoginUrl = exports.getAvailableApps = exports.getFacebookCustomConversions = exports.getFacebookPixels = exports.getFacebookInstagramAccounts = exports.getFacebookPages = exports.searchLocations = exports.searchInterests = exports.removeMaterial = exports.addMaterial = exports.deleteCreativeGroup = exports.getCreativeGroupList = exports.updateCreativeGroup = exports.createCreativeGroup = exports.parseAllCopywritingProducts = exports.deleteCopywritingPackage = exports.getCopywritingPackageList = exports.updateCopywritingPackage = exports.createCopywritingPackage = exports.deleteTargetingPackage = exports.getTargetingPackageList = exports.updateTargetingPackage = exports.createTargetingPackage = exports.rerunTask = exports.retryTask = exports.cancelTask = exports.getTaskList = exports.getTask = exports.publishDraft = exports.validateDraft = exports.deleteDraft = exports.getDraftList = exports.getDraft = exports.updateDraft = exports.createDraft = void 0;
const bulkAd_service_1 = __importDefault(require("../services/bulkAd.service"));
const TargetingPackage_1 = __importDefault(require("../models/TargetingPackage"));
const CopywritingPackage_1 = __importDefault(require("../models/CopywritingPackage"));
const CreativeGroup_1 = __importDefault(require("../models/CreativeGroup"));
const bulkCreate_api_1 = require("../integration/facebook/bulkCreate.api");
const FbToken_1 = __importDefault(require("../models/FbToken"));
const logger_1 = __importDefault(require("../utils/logger"));
const oauthService = __importStar(require("../services/facebook.oauth.service"));
const facebookClient_1 = require("../integration/facebook/facebookClient");
const productMapping_service_1 = require("../services/productMapping.service");
const auth_1 = require("../middlewares/auth");
// ==================== 草稿管理 ====================
/**
 * 创建广告草稿
 * POST /api/bulk-ad/drafts
 */
const createDraft = async (req, res) => {
    try {
        // Debug: 打印接收到的账户配置
        logger_1.default.info('[BulkAd] createDraft received accounts:', JSON.stringify(req.body.accounts?.map((a) => ({
            accountId: a.accountId,
            pixelId: a.pixelId,
            pixelName: a.pixelName
        }))));
        const draft = await bulkAd_service_1.default.createDraft(req.body);
        res.json({ success: true, data: draft });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Create draft failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.createDraft = createDraft;
/**
 * 更新广告草稿
 * PUT /api/bulk-ad/drafts/:id
 */
const updateDraft = async (req, res) => {
    try {
        const draft = await bulkAd_service_1.default.updateDraft(req.params.id, req.body);
        res.json({ success: true, data: draft });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Update draft failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.updateDraft = updateDraft;
/**
 * 获取草稿详情
 * GET /api/bulk-ad/drafts/:id
 */
const getDraft = async (req, res) => {
    try {
        const draft = await bulkAd_service_1.default.getDraft(req.params.id);
        res.json({ success: true, data: draft });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get draft failed:', error);
        res.status(404).json({ success: false, error: error.message });
    }
};
exports.getDraft = getDraft;
/**
 * 获取草稿列表
 * GET /api/bulk-ad/drafts
 */
const getDraftList = async (req, res) => {
    try {
        const result = await bulkAd_service_1.default.getDraftList(req.query);
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get draft list failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getDraftList = getDraftList;
/**
 * 删除草稿
 * DELETE /api/bulk-ad/drafts/:id
 */
const deleteDraft = async (req, res) => {
    try {
        await bulkAd_service_1.default.deleteDraft(req.params.id);
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Delete draft failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.deleteDraft = deleteDraft;
/**
 * 验证草稿
 * POST /api/bulk-ad/drafts/:id/validate
 */
const validateDraft = async (req, res) => {
    try {
        const validation = await bulkAd_service_1.default.validateDraft(req.params.id);
        res.json({ success: true, data: validation });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Validate draft failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.validateDraft = validateDraft;
/**
 * 发布草稿
 * POST /api/bulk-ad/drafts/:id/publish
 */
const publishDraft = async (req, res) => {
    try {
        const task = await bulkAd_service_1.default.publishDraft(req.params.id);
        res.json({ success: true, data: task });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Publish draft failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.publishDraft = publishDraft;
// ==================== 任务管理 ====================
/**
 * 获取任务详情
 * GET /api/bulk-ad/tasks/:id
 */
const getTask = async (req, res) => {
    try {
        const task = await bulkAd_service_1.default.getTask(req.params.id);
        res.json({ success: true, data: task });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get task failed:', error);
        res.status(404).json({ success: false, error: error.message });
    }
};
exports.getTask = getTask;
/**
 * 获取任务列表
 * GET /api/bulk-ad/tasks
 */
const getTaskList = async (req, res) => {
    try {
        const result = await bulkAd_service_1.default.getTaskList(req.query);
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get task list failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getTaskList = getTaskList;
/**
 * 取消任务
 * POST /api/bulk-ad/tasks/:id/cancel
 */
const cancelTask = async (req, res) => {
    try {
        const task = await bulkAd_service_1.default.cancelTask(req.params.id);
        res.json({ success: true, data: task });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Cancel task failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.cancelTask = cancelTask;
/**
 * 重试失败的任务项
 * POST /api/bulk-ad/tasks/:id/retry
 */
const retryTask = async (req, res) => {
    try {
        const task = await bulkAd_service_1.default.retryFailedItems(req.params.id);
        res.json({ success: true, data: task });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Retry task failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.retryTask = retryTask;
/**
 * 重新执行任务（基于原任务配置创建新任务）
 * POST /api/bulk-ad/tasks/:id/rerun
 */
const rerunTask = async (req, res) => {
    try {
        const newTask = await bulkAd_service_1.default.rerunTask(req.params.id);
        res.json({ success: true, data: newTask });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Rerun task failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.rerunTask = rerunTask;
// ==================== 定向包管理 ====================
/**
 * 创建定向包
 * POST /api/bulk-ad/targeting-packages
 */
const createTargetingPackage = async (req, res) => {
    try {
        const data = { ...req.body, organizationId: req.user?.organizationId };
        const pkg = new TargetingPackage_1.default(data);
        await pkg.save();
        res.json({ success: true, data: pkg });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Create targeting package failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.createTargetingPackage = createTargetingPackage;
/**
 * 更新定向包
 * PUT /api/bulk-ad/targeting-packages/:id
 */
const updateTargetingPackage = async (req, res) => {
    try {
        const pkg = await TargetingPackage_1.default.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!pkg) {
            return res.status(404).json({ success: false, error: 'Targeting package not found' });
        }
        res.json({ success: true, data: pkg });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Update targeting package failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.updateTargetingPackage = updateTargetingPackage;
/**
 * 获取定向包列表
 * GET /api/bulk-ad/targeting-packages
 */
const getTargetingPackageList = async (req, res) => {
    try {
        const { accountId, platform, page = 1, pageSize = 20 } = req.query;
        const filter = { ...(0, auth_1.getOrgFilter)(req) };
        if (accountId)
            filter.accountId = accountId;
        if (platform)
            filter.platform = platform;
        const [list, total] = await Promise.all([
            TargetingPackage_1.default.find(filter)
                .sort({ createdAt: -1 })
                .skip((Number(page) - 1) * Number(pageSize))
                .limit(Number(pageSize))
                .lean(),
            TargetingPackage_1.default.countDocuments(filter),
        ]);
        res.json({ success: true, data: { list, total, page: Number(page), pageSize: Number(pageSize) } });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get targeting package list failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getTargetingPackageList = getTargetingPackageList;
/**
 * 删除定向包
 * DELETE /api/bulk-ad/targeting-packages/:id
 */
const deleteTargetingPackage = async (req, res) => {
    try {
        await TargetingPackage_1.default.deleteOne({ _id: req.params.id });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Delete targeting package failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.deleteTargetingPackage = deleteTargetingPackage;
// ==================== 文案包管理 ====================
/**
 * 创建文案包
 * POST /api/bulk-ad/copywriting-packages
 */
const createCopywritingPackage = async (req, res) => {
    try {
        const data = { ...req.body, organizationId: req.user?.organizationId };
        // 自动从 websiteUrl 提取产品信息
        if (data.links?.websiteUrl && !data.product?.name) {
            const parsed = (0, productMapping_service_1.parseProductUrl)(data.links.websiteUrl);
            if (parsed) {
                data.product = {
                    name: parsed.productName || parsed.domain,
                    identifier: parsed.productIdentifier,
                    domain: parsed.domain,
                    autoExtracted: true,
                };
                logger_1.default.info(`[BulkAd] Auto-extracted product: ${data.product.name} from ${data.links.websiteUrl}`);
            }
        }
        const pkg = new CopywritingPackage_1.default(data);
        await pkg.save();
        res.json({ success: true, data: pkg });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Create copywriting package failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.createCopywritingPackage = createCopywritingPackage;
/**
 * 更新文案包
 * PUT /api/bulk-ad/copywriting-packages/:id
 */
const updateCopywritingPackage = async (req, res) => {
    try {
        const data = { ...req.body };
        // 如果更新了 websiteUrl，自动重新提取产品信息
        if (data.links?.websiteUrl) {
            const existingPkg = await CopywritingPackage_1.default.findById(req.params.id);
            const urlChanged = existingPkg?.links?.websiteUrl !== data.links.websiteUrl;
            const productNotManual = !existingPkg?.product || existingPkg.product.autoExtracted !== false;
            if (urlChanged && productNotManual) {
                const parsed = (0, productMapping_service_1.parseProductUrl)(data.links.websiteUrl);
                if (parsed) {
                    data.product = {
                        name: parsed.productName || parsed.domain,
                        identifier: parsed.productIdentifier,
                        domain: parsed.domain,
                        autoExtracted: true,
                    };
                    logger_1.default.info(`[BulkAd] Auto-updated product: ${data.product.name} from ${data.links.websiteUrl}`);
                }
            }
        }
        const pkg = await CopywritingPackage_1.default.findByIdAndUpdate(req.params.id, data, { new: true });
        if (!pkg) {
            return res.status(404).json({ success: false, error: 'Copywriting package not found' });
        }
        res.json({ success: true, data: pkg });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Update copywriting package failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.updateCopywritingPackage = updateCopywritingPackage;
/**
 * 获取文案包列表
 * GET /api/bulk-ad/copywriting-packages
 */
const getCopywritingPackageList = async (req, res) => {
    try {
        const { accountId, platform, page = 1, pageSize = 20 } = req.query;
        const filter = { ...(0, auth_1.getOrgFilter)(req) };
        if (accountId)
            filter.accountId = accountId;
        if (platform)
            filter.platform = platform;
        const [list, total] = await Promise.all([
            CopywritingPackage_1.default.find(filter)
                .sort({ createdAt: -1 })
                .skip((Number(page) - 1) * Number(pageSize))
                .limit(Number(pageSize))
                .lean(),
            CopywritingPackage_1.default.countDocuments(filter),
        ]);
        res.json({ success: true, data: { list, total, page: Number(page), pageSize: Number(pageSize) } });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get copywriting package list failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getCopywritingPackageList = getCopywritingPackageList;
/**
 * 删除文案包
 * DELETE /api/bulk-ad/copywriting-packages/:id
 */
const deleteCopywritingPackage = async (req, res) => {
    try {
        await CopywritingPackage_1.default.deleteOne({ _id: req.params.id });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Delete copywriting package failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.deleteCopywritingPackage = deleteCopywritingPackage;
/**
 * 批量解析所有文案包的产品信息
 * POST /api/bulk-ad/copywriting-packages/parse-products
 */
const parseAllCopywritingProducts = async (req, res) => {
    try {
        const packages = await CopywritingPackage_1.default.find({
            'links.websiteUrl': { $exists: true, $ne: '' },
            $or: [
                { 'product.name': { $exists: false } },
                { 'product.name': '' },
                { 'product.name': null },
            ]
        });
        let updated = 0;
        let failed = 0;
        const results = [];
        for (const pkg of packages) {
            try {
                const urlString = pkg.links?.websiteUrl;
                if (!urlString)
                    continue;
                const parsed = (0, productMapping_service_1.parseProductUrl)(urlString);
                if (parsed) {
                    pkg.product = {
                        name: parsed.productName || parsed.domain,
                        identifier: parsed.productIdentifier,
                        domain: parsed.domain,
                        autoExtracted: true,
                    };
                    await pkg.save();
                    updated++;
                    results.push({ id: pkg._id.toString(), name: pkg.name, productName: parsed.productName });
                }
            }
            catch (error) {
                failed++;
                results.push({ id: pkg._id.toString(), name: pkg.name, error: error.message });
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
        });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Parse all copywriting products failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.parseAllCopywritingProducts = parseAllCopywritingProducts;
// ==================== 创意组管理 ====================
/**
 * 创建创意组
 * POST /api/bulk-ad/creative-groups
 */
const createCreativeGroup = async (req, res) => {
    try {
        const data = { ...req.body, organizationId: req.user?.organizationId };
        const group = new CreativeGroup_1.default(data);
        await group.save();
        res.json({ success: true, data: group });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Create creative group failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.createCreativeGroup = createCreativeGroup;
/**
 * 更新创意组
 * PUT /api/bulk-ad/creative-groups/:id
 */
const updateCreativeGroup = async (req, res) => {
    try {
        const group = await CreativeGroup_1.default.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!group) {
            return res.status(404).json({ success: false, error: 'Creative group not found' });
        }
        res.json({ success: true, data: group });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Update creative group failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.updateCreativeGroup = updateCreativeGroup;
/**
 * 获取创意组列表
 * GET /api/bulk-ad/creative-groups
 */
const getCreativeGroupList = async (req, res) => {
    try {
        const { accountId, platform, page = 1, pageSize = 20 } = req.query;
        const filter = { ...(0, auth_1.getOrgFilter)(req) };
        if (accountId)
            filter.accountId = accountId;
        if (platform)
            filter.platform = platform;
        const [list, total] = await Promise.all([
            CreativeGroup_1.default.find(filter)
                .sort({ createdAt: -1 })
                .skip((Number(page) - 1) * Number(pageSize))
                .limit(Number(pageSize))
                .lean(),
            CreativeGroup_1.default.countDocuments(filter),
        ]);
        res.json({ success: true, data: { list, total, page: Number(page), pageSize: Number(pageSize) } });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get creative group list failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getCreativeGroupList = getCreativeGroupList;
/**
 * 删除创意组
 * DELETE /api/bulk-ad/creative-groups/:id
 */
const deleteCreativeGroup = async (req, res) => {
    try {
        await CreativeGroup_1.default.deleteOne({ _id: req.params.id });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Delete creative group failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.deleteCreativeGroup = deleteCreativeGroup;
/**
 * 添加素材到创意组
 * POST /api/bulk-ad/creative-groups/:id/materials
 */
const addMaterial = async (req, res) => {
    try {
        const group = await CreativeGroup_1.default.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ success: false, error: 'Creative group not found' });
        }
        group.materials.push(req.body);
        await group.save();
        res.json({ success: true, data: group });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Add material failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.addMaterial = addMaterial;
/**
 * 删除创意组中的素材
 * DELETE /api/bulk-ad/creative-groups/:id/materials/:materialId
 */
const removeMaterial = async (req, res) => {
    try {
        const group = await CreativeGroup_1.default.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ success: false, error: 'Creative group not found' });
        }
        group.materials = group.materials.filter((m) => m._id.toString() !== req.params.materialId);
        await group.save();
        res.json({ success: true, data: group });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Remove material failed:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};
exports.removeMaterial = removeMaterial;
// ==================== Facebook 搜索 API ====================
/**
 * 搜索兴趣标签
 * GET /api/bulk-ad/search/interests
 */
const searchInterests = async (req, res) => {
    try {
        const { q, type = 'adinterest', limit = 50 } = req.query;
        const fbToken = await FbToken_1.default.findOne({ status: 'active' });
        if (!fbToken) {
            return res.status(400).json({ success: false, error: 'No active Facebook token' });
        }
        const result = await (0, bulkCreate_api_1.searchTargetingInterests)({
            token: fbToken.token,
            query: q,
            type: type,
            limit: Number(limit),
        });
        res.json({ success: true, data: result.data });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Search interests failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.searchInterests = searchInterests;
/**
 * 搜索地理位置
 * GET /api/bulk-ad/search/locations
 */
const searchLocations = async (req, res) => {
    try {
        const { q, type = 'adgeolocation', limit = 50 } = req.query;
        const fbToken = await FbToken_1.default.findOne({ status: 'active' });
        if (!fbToken) {
            return res.status(400).json({ success: false, error: 'No active Facebook token' });
        }
        const result = await (0, bulkCreate_api_1.searchTargetingLocations)({
            token: fbToken.token,
            query: q,
            type: type,
            limit: Number(limit),
        });
        res.json({ success: true, data: result.data });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Search locations failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.searchLocations = searchLocations;
/**
 * 获取 Facebook Pages
 * GET /api/bulk-ad/facebook/pages
 */
const getFacebookPages = async (req, res) => {
    try {
        const { accountId } = req.query;
        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }
        const fbToken = await FbToken_1.default.findOne({ status: 'active' });
        if (!fbToken) {
            return res.status(400).json({ success: false, error: 'No active Facebook token' });
        }
        const result = await (0, bulkCreate_api_1.getPages)(accountId, fbToken.token);
        res.json({ success: true, data: result.data });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get Facebook pages failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getFacebookPages = getFacebookPages;
/**
 * 获取 Instagram 账户
 * GET /api/bulk-ad/facebook/instagram-accounts
 */
const getFacebookInstagramAccounts = async (req, res) => {
    try {
        const { pageId } = req.query;
        if (!pageId) {
            return res.status(400).json({ success: false, error: 'pageId is required' });
        }
        const fbToken = await FbToken_1.default.findOne({ status: 'active' });
        if (!fbToken) {
            return res.status(400).json({ success: false, error: 'No active Facebook token' });
        }
        const result = await (0, bulkCreate_api_1.getInstagramAccounts)(pageId, fbToken.token);
        res.json({ success: true, data: result.data });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get Instagram accounts failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getFacebookInstagramAccounts = getFacebookInstagramAccounts;
/**
 * 获取 Pixels
 * GET /api/bulk-ad/facebook/pixels
 */
const getFacebookPixels = async (req, res) => {
    try {
        const { accountId } = req.query;
        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }
        const fbToken = await FbToken_1.default.findOne({ status: 'active' });
        if (!fbToken) {
            return res.status(400).json({ success: false, error: 'No active Facebook token' });
        }
        const result = await (0, bulkCreate_api_1.getPixels)(accountId, fbToken.token);
        res.json({ success: true, data: result.data });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get Facebook pixels failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getFacebookPixels = getFacebookPixels;
/**
 * 获取自定义转化事件
 * GET /api/bulk-ad/facebook/custom-conversions
 */
const getFacebookCustomConversions = async (req, res) => {
    try {
        const { accountId } = req.query;
        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }
        const fbToken = await FbToken_1.default.findOne({ status: 'active' });
        if (!fbToken) {
            return res.status(400).json({ success: false, error: 'No active Facebook token' });
        }
        const result = await (0, bulkCreate_api_1.getCustomConversions)(accountId, fbToken.token);
        res.json({ success: true, data: result.data });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get custom conversions failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getFacebookCustomConversions = getFacebookCustomConversions;
// ==================== 独立 OAuth 授权 ====================
/**
 * 获取可用的 Facebook Apps 列表
 * GET /api/bulk-ad/auth/apps
 */
const getAvailableApps = async (req, res) => {
    try {
        const apps = await oauthService.getAvailableApps();
        res.json({ success: true, data: apps });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get available apps failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getAvailableApps = getAvailableApps;
/**
 * 获取 Facebook 登录 URL（批量广告专用，支持选择 App）
 * GET /api/bulk-ad/auth/login-url
 */
const getAuthLoginUrl = async (req, res) => {
    try {
        const { appId } = req.query; // 可选，指定使用哪个 App
        const config = await oauthService.validateOAuthConfig();
        if (!config.valid) {
            return res.status(500).json({
                success: false,
                error: config.hasDbApps
                    ? `OAuth 配置不完整，缺少: ${config.missing.join(', ')}`
                    : '未配置 Facebook App，请在 App 管理页面添加',
                needsAppSetup: !config.hasDbApps,
            });
        }
        // 使用特殊 state 标记来自批量广告模块
        const loginUrl = await oauthService.getFacebookLoginUrl('bulk-ad', appId);
        res.json({
            success: true,
            data: { loginUrl },
        });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get login URL failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getAuthLoginUrl = getAuthLoginUrl;
/**
 * OAuth 回调处理（批量广告专用）
 * GET /api/bulk-ad/auth/callback
 */
const handleAuthCallback = async (req, res) => {
    try {
        const { code, error, error_description, state } = req.query;
        if (error) {
            logger_1.default.error('[BulkAd OAuth] Facebook returned error:', { error, error_description });
            // 重定向到专门的 OAuth 回调页面（用于关闭弹窗）
            return res.redirect(`/oauth/callback?oauth_error=${encodeURIComponent(error_description || error)}`);
        }
        if (!code) {
            return res.redirect('/oauth/callback?oauth_error=No authorization code received');
        }
        // 处理 OAuth 回调（传递 state 以解析使用的 App）
        const result = await oauthService.handleOAuthCallback(code, state);
        // 异步同步 Facebook 用户资产（Pixels、账户、粉丝页）
        // 不阻塞用户，后台执行
        const facebookUserService = require('../services/facebookUser.service');
        facebookUserService.syncFacebookUserAssets(result.fbUserId, result.accessToken, result.tokenId).catch((err) => {
            logger_1.default.error('[BulkAd OAuth] Failed to sync Facebook user assets:', err);
        });
        // 重定向到专门的 OAuth 回调页面（用于关闭弹窗并通知父窗口）
        const params = new URLSearchParams({
            oauth_success: 'true',
            token_id: result.tokenId,
            fb_user_id: result.fbUserId,
            fb_user_name: encodeURIComponent(result.fbUserName || ''),
        });
        res.redirect(`/oauth/callback?${params.toString()}`);
    }
    catch (error) {
        logger_1.default.error('[BulkAd OAuth] Callback handler failed:', error);
        res.redirect(`/oauth/callback?oauth_error=${encodeURIComponent(error.message || 'OAuth callback failed')}`);
    }
};
exports.handleAuthCallback = handleAuthCallback;
/**
 * 检查授权状态
 * GET /api/bulk-ad/auth/status
 */
const getAuthStatus = async (req, res) => {
    try {
        const fbToken = await FbToken_1.default.findOne({ status: 'active' }).sort({ updatedAt: -1 });
        if (!fbToken) {
            return res.json({
                success: true,
                data: {
                    authorized: false,
                    message: '未授权 Facebook 账号',
                },
            });
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
        });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get auth status failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getAuthStatus = getAuthStatus;
/**
 * 获取当前授权用户的广告账户列表
 * GET /api/bulk-ad/auth/ad-accounts
 */
const getAuthAdAccounts = async (req, res) => {
    try {
        const fbToken = await FbToken_1.default.findOne({ status: 'active' }).sort({ updatedAt: -1 });
        if (!fbToken) {
            return res.status(401).json({ success: false, error: '未授权 Facebook 账号' });
        }
        // 获取用户的广告账户
        const result = await facebookClient_1.facebookClient.get('/me/adaccounts', {
            access_token: fbToken.token,
            fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance',
            limit: 100,
        });
        const accounts = (result.data || []).map((acc) => ({
            id: acc.id,
            account_id: acc.account_id,
            name: acc.name,
            account_status: acc.account_status,
            currency: acc.currency,
            timezone_name: acc.timezone_name,
            amount_spent: acc.amount_spent,
            balance: acc.balance,
        }));
        res.json({ success: true, data: accounts });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get ad accounts failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getAuthAdAccounts = getAuthAdAccounts;
/**
 * 获取账户的 Pages
 * GET /api/bulk-ad/auth/pages
 *
 * 策略：
 * 1. 先尝试从广告账户获取 promote_pages（BM 分配的主页）
 * 2. 如果没有结果，回退获取用户有广告权限的所有主页
 */
const getAuthPages = async (req, res) => {
    try {
        const { accountId } = req.query;
        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }
        const fbToken = await FbToken_1.default.findOne({ status: 'active' }).sort({ updatedAt: -1 });
        if (!fbToken) {
            return res.status(401).json({ success: false, error: '未授权 Facebook 账号' });
        }
        // 1. 先尝试从广告账户获取 promote_pages
        let pages = [];
        try {
            const promoteResult = await facebookClient_1.facebookClient.get(`/act_${accountId}/promote_pages`, {
                access_token: fbToken.token,
                fields: 'id,name,picture',
                limit: 100,
            });
            pages = promoteResult.data || [];
        }
        catch (e) {
            logger_1.default.warn(`[BulkAd] Failed to get promote_pages for ${accountId}: ${e.message}`);
        }
        // 2. 如果没有 promote_pages，获取用户有广告权限的所有主页
        if (pages.length === 0) {
            logger_1.default.info(`[BulkAd] No promote_pages for ${accountId}, falling back to user pages`);
            try {
                const userPagesResult = await facebookClient_1.facebookClient.get('/me/accounts', {
                    access_token: fbToken.token,
                    fields: 'id,name,picture,tasks',
                    limit: 100,
                });
                // 只返回有 ADVERTISE 权限的主页
                pages = (userPagesResult.data || []).filter((page) => page.tasks && page.tasks.includes('ADVERTISE'));
                logger_1.default.info(`[BulkAd] Found ${pages.length} user pages with ADVERTISE permission`);
            }
            catch (e) {
                logger_1.default.error(`[BulkAd] Failed to get user pages: ${e.message}`);
            }
        }
        res.json({ success: true, data: pages });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get pages failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getAuthPages = getAuthPages;
/**
 * 获取账户的 Pixels
 * GET /api/bulk-ad/auth/pixels
 */
const getAuthPixels = async (req, res) => {
    try {
        const { accountId } = req.query;
        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }
        const fbToken = await FbToken_1.default.findOne({ status: 'active' }).sort({ updatedAt: -1 });
        if (!fbToken) {
            return res.status(401).json({ success: false, error: '未授权 Facebook 账号' });
        }
        const result = await facebookClient_1.facebookClient.get(`/act_${accountId}/adspixels`, {
            access_token: fbToken.token,
            fields: 'id,name,code,last_fired_time',
            limit: 100,
        });
        res.json({ success: true, data: result.data || [] });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get pixels failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getAuthPixels = getAuthPixels;
/**
 * 获取缓存的所有 Pixels（预加载，速度快）
 * GET /api/bulk-ad/auth/cached-pixels
 */
const getCachedPixels = async (req, res) => {
    try {
        const fbToken = await FbToken_1.default.findOne({ status: 'active' }).sort({ updatedAt: -1 });
        if (!fbToken) {
            return res.status(401).json({ success: false, error: '未授权 Facebook 账号' });
        }
        const facebookUserService = require('../services/facebookUser.service');
        const pixels = await facebookUserService.getCachedPixels(fbToken.fbUserId);
        // 转换格式以兼容前端
        const formattedPixels = pixels.map((p) => ({
            id: p.pixelId,
            name: p.name,
            accounts: p.accounts || [],
        }));
        res.json({ success: true, data: formattedPixels });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get cached pixels failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getCachedPixels = getCachedPixels;
/**
 * 获取 Pixel 同步状态
 * GET /api/bulk-ad/auth/sync-status
 */
const getPixelSyncStatus = async (req, res) => {
    try {
        const fbToken = await FbToken_1.default.findOne({ status: 'active' }).sort({ updatedAt: -1 });
        if (!fbToken) {
            return res.status(401).json({ success: false, error: '未授权 Facebook 账号' });
        }
        const facebookUserService = require('../services/facebookUser.service');
        const status = await facebookUserService.getSyncStatus(fbToken.fbUserId);
        res.json({ success: true, data: status });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get sync status failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getPixelSyncStatus = getPixelSyncStatus;
/**
 * 手动触发重新同步
 * POST /api/bulk-ad/auth/resync
 */
const resyncFacebookAssets = async (req, res) => {
    try {
        const fbToken = await FbToken_1.default.findOne({ status: 'active' }).sort({ updatedAt: -1 });
        if (!fbToken) {
            return res.status(401).json({ success: false, error: '未授权 Facebook 账号' });
        }
        const facebookUserService = require('../services/facebookUser.service');
        // 异步执行同步
        facebookUserService.syncFacebookUserAssets(fbToken.fbUserId, fbToken.token, fbToken._id.toString()).catch((err) => {
            logger_1.default.error('[BulkAd] Resync failed:', err);
        });
        res.json({ success: true, message: '同步已开始，请稍后刷新' });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Resync trigger failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.resyncFacebookAssets = resyncFacebookAssets;
// ==================== 广告审核状态 ====================
/**
 * 获取任务的广告审核状态
 * GET /api/bulk-ad/tasks/:id/review-status
 */
const getTaskReviewStatus = async (req, res) => {
    try {
        const { getTaskReviewDetails } = await Promise.resolve().then(() => __importStar(require('../services/adReview.service')));
        const result = await getTaskReviewDetails(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get task review status failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getTaskReviewStatus = getTaskReviewStatus;
/**
 * 检查/刷新任务的广告审核状态
 * POST /api/bulk-ad/tasks/:id/check-review
 */
const checkTaskReviewStatus = async (req, res) => {
    try {
        const { updateTaskAdsReviewStatus } = await Promise.resolve().then(() => __importStar(require('../services/adReview.service')));
        const result = await updateTaskAdsReviewStatus(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Check task review status failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.checkTaskReviewStatus = checkTaskReviewStatus;
/**
 * 获取所有 AutoArk 广告审核概览
 * GET /api/bulk-ad/ads/review-overview
 */
const getAdsReviewOverview = async (req, res) => {
    try {
        const { getReviewOverview } = await Promise.resolve().then(() => __importStar(require('../services/adReview.service')));
        const result = await getReviewOverview();
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Get ads review overview failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getAdsReviewOverview = getAdsReviewOverview;
/**
 * 刷新所有 AutoArk 广告的审核状态
 * POST /api/bulk-ad/ads/refresh-review
 */
const refreshAdsReviewStatus = async (req, res) => {
    try {
        const { refreshAllReviewStatus } = await Promise.resolve().then(() => __importStar(require('../services/adReview.service')));
        const result = await refreshAllReviewStatus();
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('[BulkAd] Refresh ads review status failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.refreshAdsReviewStatus = refreshAdsReviewStatus;
