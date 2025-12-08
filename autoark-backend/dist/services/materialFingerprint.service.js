"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.comparePHash = comparePHash;
exports.generateFingerprintFromUrl = generateFingerprintFromUrl;
exports.downloadAndStoreMaterial = downloadAndStoreMaterial;
exports.batchDownloadMaterials = batchDownloadMaterials;
exports.findSimilarByFingerprint = findSimilarByFingerprint;
const crypto_1 = __importDefault(require("crypto"));
const sharp_1 = __importDefault(require("sharp"));
const logger_1 = __importDefault(require("../utils/logger"));
const r2Storage_service_1 = require("./r2Storage.service");
/**
 * 素材指纹服务
 * 用于生成素材的唯一标识指纹，支持跨系统归因
 *
 * 指纹策略：
 * 1. pHash (感知哈希) - 抗压缩、抗缩放，适合图片素材识别
 * 2. MD5 - 文件内容精确匹配
 * 3. Facebook 原生标识 - imageHash, videoId
 */
// 简化的 pHash 实现
// 原理：将图片缩小到 8x8 灰度图，计算 DCT，提取低频特征
async function calculatePHash(imageBuffer) {
    try {
        // 1. 缩放到 32x32 灰度图
        const resizedBuffer = await (0, sharp_1.default)(imageBuffer)
            .resize(32, 32, { fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer();
        // 2. 计算 8x8 的平均值块
        const blockSize = 4; // 32/8 = 4
        const blocks = [];
        for (let blockY = 0; blockY < 8; blockY++) {
            for (let blockX = 0; blockX < 8; blockX++) {
                let sum = 0;
                for (let y = 0; y < blockSize; y++) {
                    for (let x = 0; x < blockSize; x++) {
                        const pixelIndex = (blockY * blockSize + y) * 32 + (blockX * blockSize + x);
                        sum += resizedBuffer[pixelIndex] || 0;
                    }
                }
                blocks.push(sum / (blockSize * blockSize));
            }
        }
        // 3. 计算均值
        const avg = blocks.reduce((a, b) => a + b, 0) / blocks.length;
        // 4. 生成二进制哈希
        let hash = '';
        for (const block of blocks) {
            hash += block >= avg ? '1' : '0';
        }
        // 5. 转换为十六进制
        const hexHash = parseInt(hash, 2).toString(16).padStart(16, '0');
        return hexHash;
    }
    catch (error) {
        logger_1.default.error('[Fingerprint] pHash calculation failed:', error.message);
        return '';
    }
}
// 计算 MD5
function calculateMD5(buffer) {
    return crypto_1.default.createHash('md5').update(buffer).digest('hex');
}
// 比较两个 pHash 的相似度（汉明距离）
function comparePHash(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length)
        return 0;
    // 转换为二进制
    const bin1 = parseInt(hash1, 16).toString(2).padStart(64, '0');
    const bin2 = parseInt(hash2, 16).toString(2).padStart(64, '0');
    // 计算相同位数
    let same = 0;
    for (let i = 0; i < bin1.length; i++) {
        if (bin1[i] === bin2[i])
            same++;
    }
    // 返回相似度百分比
    return (same / bin1.length) * 100;
}
/**
 * 从 URL 下载图片并生成指纹
 */
async function generateFingerprintFromUrl(imageUrl) {
    try {
        logger_1.default.info(`[Fingerprint] Downloading image from: ${imageUrl.substring(0, 100)}...`);
        // 下载图片
        const response = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0) {
            throw new Error('Empty response');
        }
        // 获取图片元信息
        const metadata = await (0, sharp_1.default)(buffer).metadata();
        // 计算指纹
        const pHash = await calculatePHash(buffer);
        const md5 = calculateMD5(buffer);
        logger_1.default.info(`[Fingerprint] Generated: pHash=${pHash}, md5=${md5.substring(0, 8)}..., size=${buffer.length}`);
        return {
            success: true,
            fingerprint: {
                pHash,
                md5,
                fileSize: buffer.length,
                width: metadata.width || 0,
                height: metadata.height || 0,
            },
            buffer,
        };
    }
    catch (error) {
        logger_1.default.error(`[Fingerprint] Failed to process image: ${error.message}`);
        return {
            success: false,
            error: error.message,
        };
    }
}
/**
 * 下载素材并存储到 R2
 */
async function downloadAndStoreMaterial(params) {
    const { sourceUrl, creativeId, type } = params;
    try {
        logger_1.default.info(`[MaterialDownload] Starting download for creative ${creativeId}`);
        // 1. 下载文件
        const response = await fetch(sourceUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || (type === 'video' ? 'video/mp4' : 'image/jpeg');
        // 2. 计算指纹（仅图片）
        let fingerprint = null;
        if (type === 'image') {
            const metadata = await (0, sharp_1.default)(buffer).metadata();
            fingerprint = {
                pHash: await calculatePHash(buffer),
                md5: calculateMD5(buffer),
                fileSize: buffer.length,
                width: metadata.width || 0,
                height: metadata.height || 0,
            };
        }
        else {
            // 视频只计算 MD5
            fingerprint = {
                pHash: '',
                md5: calculateMD5(buffer),
                fileSize: buffer.length,
                width: 0,
                height: 0,
            };
        }
        // 3. 上传到 R2
        const ext = type === 'video' ? 'mp4' : (contentType.includes('png') ? 'png' : 'jpg');
        const fileName = `${creativeId}.${ext}`;
        const uploadResult = await (0, r2Storage_service_1.uploadToR2)({
            buffer,
            originalName: fileName,
            mimeType: contentType,
            folder: 'fb-creatives',
        });
        if (!uploadResult.success) {
            throw new Error(uploadResult.error || 'Upload failed');
        }
        logger_1.default.info(`[MaterialDownload] Success: ${creativeId} -> ${uploadResult.url}`);
        return {
            success: true,
            localStorageUrl: uploadResult.url,
            localStorageKey: uploadResult.key,
            fingerprint,
        };
    }
    catch (error) {
        logger_1.default.error(`[MaterialDownload] Failed for ${creativeId}: ${error.message}`);
        return {
            success: false,
            error: error.message,
        };
    }
}
/**
 * 批量下载素材（带限流）
 */
async function batchDownloadMaterials(creatives, options = {}) {
    const { concurrency = 3, delayMs = 500 } = options;
    const results = [];
    let success = 0;
    let failed = 0;
    // 按批次处理
    for (let i = 0; i < creatives.length; i += concurrency) {
        const batch = creatives.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(async (creative) => {
            const sourceUrl = creative.imageUrl || creative.thumbnailUrl;
            if (!sourceUrl) {
                failed++;
                return { creativeId: creative.creativeId, success: false, error: 'No source URL' };
            }
            const result = await downloadAndStoreMaterial({
                sourceUrl,
                creativeId: creative.creativeId,
                type: creative.type,
            });
            if (result.success) {
                success++;
            }
            else {
                failed++;
            }
            return {
                creativeId: creative.creativeId,
                success: result.success,
                localStorageUrl: result.localStorageUrl,
                fingerprint: result.fingerprint,
                error: result.error,
            };
        }));
        results.push(...batchResults);
        // 批次间延迟
        if (i + concurrency < creatives.length) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        logger_1.default.info(`[MaterialDownload] Progress: ${i + batch.length}/${creatives.length} (${success} success, ${failed} failed)`);
    }
    return { success, failed, results };
}
/**
 * 通过指纹查找相似素材
 */
async function findSimilarByFingerprint(fingerprint, threshold = 85 // 相似度阈值
) {
    // 这个功能需要在数据库层面实现
    // 可以考虑使用 MongoDB 的聚合管道或专门的相似度搜索服务
    // 暂时返回空数组
    return [];
}
exports.default = {
    generateFingerprintFromUrl,
    downloadAndStoreMaterial,
    batchDownloadMaterials,
    comparePHash,
    findSimilarByFingerprint,
};
