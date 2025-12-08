"use strict";
/**
 * 素材同步服务
 *
 * 从 Facebook 同步素材到本地，建立素材指纹归因系统
 *
 * 核心流程：
 * 1. 从 Facebook API 获取 Creatives（含 imageHash / videoId / thumbnailUrl）
 * 2. 下载素材到 R2 存储
 * 3. 创建 Material 记录，设置 fingerprint
 * 4. 关联 Creative → Material
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMaterialPreviewsByFingerprints = exports.getMaterialPreviewByFingerprint = exports.syncCreativesToMaterials = exports.syncCreativeToMaterial = exports.generateFingerprint = void 0;
const axios_1 = __importDefault(require("axios"));
const Creative_1 = __importDefault(require("../models/Creative"));
const Material_1 = __importDefault(require("../models/Material"));
const r2Storage_service_1 = require("./r2Storage.service");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * 生成素材指纹
 * 规则：
 * - 图片：img_{imageHash}
 * - 视频：vid_{videoId}
 * - 无法识别：cre_{creativeId}
 */
const generateFingerprint = (creative) => {
    if (creative.imageHash) {
        return `img_${creative.imageHash}`;
    }
    if (creative.videoId) {
        return `vid_${creative.videoId}`;
    }
    // 回退到 creativeId
    return `cre_${creative.creativeId || creative.id}`;
};
exports.generateFingerprint = generateFingerprint;
/**
 * 从 URL 下载文件到 Buffer
 */
const downloadFile = async (url) => {
    try {
        const response = await axios_1.default.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000, // 30秒超时
            headers: {
                'User-Agent': 'AutoArk/1.0',
            },
        });
        const mimeType = response.headers['content-type'] || 'image/jpeg';
        return {
            buffer: Buffer.from(response.data),
            mimeType,
        };
    }
    catch (error) {
        logger_1.default.error(`[MaterialSync] Failed to download: ${url}`, error.message);
        return null;
    }
};
/**
 * 获取素材的预览图 URL
 */
const getPreviewUrl = (creative) => {
    // 优先使用 thumbnailUrl
    if (creative.thumbnailUrl)
        return creative.thumbnailUrl;
    // 图片素材使用 imageUrl
    if (creative.imageUrl)
        return creative.imageUrl;
    // 从 raw 数据中提取
    if (creative.raw) {
        const oss = creative.raw.object_story_spec;
        if (oss) {
            if (oss.video_data?.image_url)
                return oss.video_data.image_url;
            if (oss.video_data?.thumbnail_url)
                return oss.video_data.thumbnail_url;
            if (oss.link_data?.picture)
                return oss.link_data.picture;
            if (oss.link_data?.image_hash)
                return null; // 需要单独处理
        }
        // 直接访问 thumbnail_url
        if (creative.raw.thumbnail_url)
            return creative.raw.thumbnail_url;
        if (creative.raw.image_url)
            return creative.raw.image_url;
    }
    return null;
};
/**
 * 同步单个 Creative 到 Material
 */
const syncCreativeToMaterial = async (creative) => {
    try {
        const fingerprint = (0, exports.generateFingerprint)(creative);
        // 检查是否已存在（使用 fingerprintKey）
        const existingMaterial = await Material_1.default.findOne({ fingerprintKey: fingerprint });
        if (existingMaterial) {
            // 已存在，更新 Creative 的 materialId
            await Creative_1.default.findOneAndUpdate({ creativeId: creative.creativeId || creative.id }, { materialId: existingMaterial._id });
            return {
                success: true,
                materialId: existingMaterial._id.toString(),
                fingerprint,
                skipped: true
            };
        }
        // 获取预览图 URL
        const previewUrl = getPreviewUrl(creative);
        if (!previewUrl) {
            logger_1.default.warn(`[MaterialSync] No preview URL for creative ${creative.creativeId}`);
            return { success: false, error: 'No preview URL available', fingerprint };
        }
        // 下载文件
        const downloaded = await downloadFile(previewUrl);
        if (!downloaded) {
            return { success: false, error: 'Download failed', fingerprint };
        }
        // 确定文件类型
        const isVideo = creative.type === 'video' || creative.videoId;
        const ext = downloaded.mimeType.includes('video') ? '.mp4' :
            downloaded.mimeType.includes('png') ? '.png' : '.jpg';
        const fileName = `${fingerprint}${ext}`;
        // 上传到 R2
        const uploadResult = await (0, r2Storage_service_1.uploadToR2)({
            buffer: downloaded.buffer,
            originalName: fileName,
            mimeType: downloaded.mimeType,
            folder: 'fb-materials', // 专门的 Facebook 素材文件夹
        });
        if (!uploadResult.success) {
            return { success: false, error: uploadResult.error, fingerprint };
        }
        // 创建 Material 记录
        const material = new Material_1.default({
            name: creative.name || `FB素材_${fingerprint.substring(0, 12)}`,
            type: isVideo ? 'video' : 'image',
            status: 'uploaded',
            fingerprint,
            source: {
                type: 'facebook',
                fbCreativeId: creative.creativeId || creative.id,
                fbAccountId: creative.accountId,
                importedAt: new Date(),
            },
            storage: {
                provider: 'r2',
                bucket: process.env.R2_BUCKET_NAME,
                key: uploadResult.key,
                url: uploadResult.url,
            },
            file: {
                originalName: fileName,
                mimeType: downloaded.mimeType,
                size: downloaded.buffer.length,
                width: creative.width,
                height: creative.height,
                duration: creative.duration,
            },
            facebook: {
                imageHash: creative.imageHash,
                videoId: creative.videoId,
            },
            folder: 'Facebook导入',
            tags: ['facebook', 'auto-import'],
        });
        await material.save();
        // 更新 Creative 的 materialId
        await Creative_1.default.findOneAndUpdate({ creativeId: creative.creativeId || creative.id }, { materialId: material._id });
        logger_1.default.info(`[MaterialSync] Synced creative ${creative.creativeId} → material ${material._id}`);
        return {
            success: true,
            materialId: material._id.toString(),
            fingerprint,
        };
    }
    catch (error) {
        logger_1.default.error(`[MaterialSync] Error syncing creative:`, error);
        return { success: false, error: error.message };
    }
};
exports.syncCreativeToMaterial = syncCreativeToMaterial;
/**
 * 批量同步 Creatives 到 Materials
 */
const syncCreativesToMaterials = async (options) => {
    const { limit = 100, accountId, onlyMissing = true } = options || {};
    const query = {};
    if (accountId)
        query.accountId = accountId;
    if (onlyMissing)
        query.materialId = { $exists: false };
    // 只处理有素材标识的
    query.$or = [
        { imageHash: { $exists: true, $ne: null } },
        { videoId: { $exists: true, $ne: null } },
        { thumbnailUrl: { $exists: true, $ne: null } },
    ];
    const creatives = await Creative_1.default.find(query).limit(limit).lean();
    logger_1.default.info(`[MaterialSync] Starting sync for ${creatives.length} creatives`);
    const stats = { total: creatives.length, synced: 0, skipped: 0, failed: 0, errors: [] };
    for (const creative of creatives) {
        const result = await (0, exports.syncCreativeToMaterial)(creative);
        if (result.success) {
            if (result.skipped) {
                stats.skipped++;
            }
            else {
                stats.synced++;
            }
        }
        else {
            stats.failed++;
            if (result.error) {
                stats.errors.push(`${creative.creativeId}: ${result.error}`);
            }
        }
    }
    logger_1.default.info(`[MaterialSync] Sync complete: ${JSON.stringify(stats)}`);
    return stats;
};
exports.syncCreativesToMaterials = syncCreativesToMaterials;
/**
 * 获取 Material 的预览信息（用于前端展示）
 * 通过 fingerprintKey 快速查找
 */
const getMaterialPreviewByFingerprint = async (fingerprint) => {
    const material = await Material_1.default.findOne({ fingerprintKey: fingerprint }).lean();
    if (!material)
        return null;
    return {
        materialId: material._id.toString(),
        name: material.name,
        thumbnailUrl: material.storage?.url,
        type: material.type,
    };
};
exports.getMaterialPreviewByFingerprint = getMaterialPreviewByFingerprint;
/**
 * 批量获取 Materials 预览信息
 */
const getMaterialPreviewsByFingerprints = async (fingerprints) => {
    const materials = await Material_1.default.find({
        fingerprintKey: { $in: fingerprints }
    }).lean();
    const map = new Map();
    for (const m of materials) {
        const material = m;
        if (material.fingerprintKey) {
            map.set(material.fingerprintKey, {
                materialId: material._id.toString(),
                name: material.name,
                thumbnailUrl: material.storage?.url,
                type: material.type,
            });
        }
    }
    return map;
};
exports.getMaterialPreviewsByFingerprints = getMaterialPreviewsByFingerprints;
exports.default = {
    generateFingerprint: exports.generateFingerprint,
    syncCreativeToMaterial: exports.syncCreativeToMaterial,
    syncCreativesToMaterials: exports.syncCreativesToMaterials,
    getMaterialPreviewByFingerprint: exports.getMaterialPreviewByFingerprint,
    getMaterialPreviewsByFingerprints: exports.getMaterialPreviewsByFingerprints,
};
