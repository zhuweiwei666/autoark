"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePresignedUploadUrls = exports.generatePresignedUploadUrl = exports.checkR2Config = exports.deleteFromR2 = exports.uploadToR2 = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * Cloudflare R2 存储服务
 * R2 兼容 S3 API
 */
// R2 配置
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''; // 公开访问的 URL 前缀
// 创建 S3 客户端（R2 兼容）
let s3Client = null;
const getS3Client = () => {
    if (!s3Client) {
        if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
            throw new Error('R2 配置不完整，请检查环境变量');
        }
        s3Client = new client_s3_1.S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY,
            },
        });
    }
    return s3Client;
};
/**
 * 生成存储路径
 */
const generateStorageKey = (originalName, folder) => {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const uuid = (0, uuid_1.v4)();
    const ext = path_1.default.extname(originalName).toLowerCase() || '.bin';
    const prefix = folder ? `${folder}/` : 'uploads/';
    return `${prefix}${date}/${uuid}${ext}`;
};
/**
 * 上传文件到 R2
 */
const uploadToR2 = async (params) => {
    const { buffer, originalName, mimeType, folder } = params;
    logger_1.default.info(`[R2] Starting upload: ${originalName}, size: ${buffer.length}, type: ${mimeType}, folder: ${folder}`);
    try {
        logger_1.default.info(`[R2] Getting S3 client...`);
        const client = getS3Client();
        const key = generateStorageKey(originalName, folder);
        logger_1.default.info(`[R2] Generated key: ${key}, bucket: ${R2_BUCKET_NAME}`);
        logger_1.default.info(`[R2] Endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
        const command = new client_s3_1.PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
        });
        logger_1.default.info(`[R2] Sending to R2...`);
        const startTime = Date.now();
        await client.send(command);
        const duration = Date.now() - startTime;
        logger_1.default.info(`[R2] Upload completed in ${duration}ms`);
        // 生成公开访问 URL
        const url = R2_PUBLIC_URL
            ? `${R2_PUBLIC_URL}/${key}`
            : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`;
        logger_1.default.info(`[R2] File uploaded: ${key}, URL: ${url}`);
        return {
            success: true,
            key,
            url,
        };
    }
    catch (error) {
        logger_1.default.error('[R2] Upload failed:', error.message);
        logger_1.default.error('[R2] Error details:', error.name, error.code, error.$metadata);
        return {
            success: false,
            error: error.message,
        };
    }
};
exports.uploadToR2 = uploadToR2;
/**
 * 从 R2 删除文件
 */
const deleteFromR2 = async (key) => {
    try {
        const client = getS3Client();
        const command = new client_s3_1.DeleteObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
        });
        await client.send(command);
        logger_1.default.info(`[R2] File deleted: ${key}`);
        return { success: true };
    }
    catch (error) {
        logger_1.default.error('[R2] Delete failed:', error);
        return {
            success: false,
            error: error.message,
        };
    }
};
exports.deleteFromR2 = deleteFromR2;
/**
 * 检查 R2 配置是否完整
 */
const checkR2Config = () => {
    const missing = [];
    if (!R2_ACCOUNT_ID)
        missing.push('R2_ACCOUNT_ID');
    if (!R2_ACCESS_KEY_ID)
        missing.push('R2_ACCESS_KEY_ID');
    if (!R2_SECRET_ACCESS_KEY)
        missing.push('R2_SECRET_ACCESS_KEY');
    if (!R2_BUCKET_NAME)
        missing.push('R2_BUCKET_NAME');
    return {
        configured: missing.length === 0,
        missing,
    };
};
exports.checkR2Config = checkR2Config;
/**
 * 生成预签名上传 URL（用于客户端直传）
 * 客户端可以使用此 URL 直接 PUT 文件到 R2，无需经过服务器
 */
const generatePresignedUploadUrl = async (params) => {
    const { fileName, mimeType, folder, expiresIn = 3600 } = params;
    logger_1.default.info(`[R2] Generating presigned URL for: ${fileName}, type: ${mimeType}`);
    try {
        const client = getS3Client();
        const key = generateStorageKey(fileName, folder);
        const command = new client_s3_1.PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            ContentType: mimeType,
        });
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(client, command, { expiresIn });
        // 生成公开访问 URL
        const publicUrl = R2_PUBLIC_URL
            ? `${R2_PUBLIC_URL}/${key}`
            : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`;
        logger_1.default.info(`[R2] Presigned URL generated for: ${key}`);
        return {
            success: true,
            uploadUrl,
            key,
            publicUrl,
        };
    }
    catch (error) {
        logger_1.default.error('[R2] Generate presigned URL failed:', error.message);
        return {
            success: false,
            error: error.message,
        };
    }
};
exports.generatePresignedUploadUrl = generatePresignedUploadUrl;
/**
 * 批量生成预签名上传 URL
 */
const generatePresignedUploadUrls = async (files) => {
    logger_1.default.info(`[R2] Generating presigned URLs for ${files.length} files`);
    try {
        const results = await Promise.all(files.map(async (file) => {
            const result = await (0, exports.generatePresignedUploadUrl)({
                fileName: file.fileName,
                mimeType: file.mimeType,
                folder: 'materials',
            });
            if (!result.success) {
                throw new Error(`Failed to generate URL for ${file.fileName}: ${result.error}`);
            }
            return {
                fileName: file.fileName,
                uploadUrl: result.uploadUrl,
                key: result.key,
                publicUrl: result.publicUrl,
            };
        }));
        return {
            success: true,
            urls: results,
        };
    }
    catch (error) {
        logger_1.default.error('[R2] Generate presigned URLs failed:', error.message);
        return {
            success: false,
            error: error.message,
        };
    }
};
exports.generatePresignedUploadUrls = generatePresignedUploadUrls;
exports.default = {
    uploadToR2: exports.uploadToR2,
    deleteFromR2: exports.deleteFromR2,
    checkR2Config: exports.checkR2Config,
    generatePresignedUploadUrl: exports.generatePresignedUploadUrl,
    generatePresignedUploadUrls: exports.generatePresignedUploadUrls,
};
