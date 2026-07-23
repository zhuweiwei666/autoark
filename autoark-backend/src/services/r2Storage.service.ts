import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { createHash } from 'crypto'
import logger from '../utils/logger'

/**
 * Cloudflare R2 存储服务
 * R2 兼容 S3 API
 */

// R2 配置
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || ''
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '' // 公开访问的 URL 前缀

const hashForLog = (value: unknown): string | undefined => {
  if (!value) return undefined
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

const getKeyLogMeta = (key?: string) => {
  if (!key) return { keyHash: undefined, folderDepth: 0 }
  const parts = String(key).split('/').filter(Boolean)
  return {
    keyHash: hashForLog(key),
    folderDepth: Math.max(0, parts.length - 1),
  }
}

// 创建 S3 客户端（R2 兼容）
let s3Client: S3Client | null = null

const getS3Client = () => {
  if (!s3Client) {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error('R2 配置不完整，请检查环境变量')
    }

    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  }
  return s3Client
}

/**
 * 生成存储路径
 */
const generateStorageKey = (originalName: string, folder?: string): string => {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const uuid = uuidv4()
  const ext = path.extname(originalName).toLowerCase() || '.bin'
  const safeFolder = (folder || 'uploads')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 80))
    .join('/')
  const prefix = `${safeFolder || 'uploads'}/`
  return `${prefix}${date}/${uuid}${ext}`
}

export const getPublicUrlForKey = (key: string): string => {
  const normalizedKey = String(key || '').replace(/^\/+/, '')
  return R2_PUBLIC_URL
    ? `${R2_PUBLIC_URL.replace(/\/+$/, '')}/${normalizedKey}`
    : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${normalizedKey}`
}

/**
 * 上传文件到 R2
 */
export const uploadToR2 = async (params: {
  buffer: Buffer
  originalName: string
  mimeType: string
  folder?: string
  key?: string
}): Promise<{
  success: boolean
  key?: string
  url?: string
  error?: string
}> => {
  const { buffer, originalName, mimeType, folder } = params
  const key = params.key || generateStorageKey(originalName, folder)

  logger.info('[R2] Starting upload', {
    size: buffer.length,
    mimeType,
    hasFolder: Boolean(folder),
    extension: path.extname(originalName).toLowerCase() || '.bin',
  })

  try {
    logger.info('[R2] Getting S3 client')
    const client = getS3Client()
    logger.info('[R2] Generated object key', {
      ...getKeyLogMeta(key),
      bucketConfigured: Boolean(R2_BUCKET_NAME),
    })

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })

    logger.info('[R2] Sending to R2')
    const startTime = Date.now()
    await client.send(command)
    const duration = Date.now() - startTime
    logger.info('[R2] Upload completed', {
      durationMs: duration,
      ...getKeyLogMeta(key),
    })

    // 生成公开访问 URL
    const url = getPublicUrlForKey(key)

    logger.info('[R2] File uploaded', {
      ...getKeyLogMeta(key),
      hasPublicUrl: Boolean(url),
    })

    return {
      success: true,
      key,
      url,
    }
  } catch (error: any) {
    logger.error('[R2] Upload failed:', error.message)
    logger.error('[R2] Error details:', error.name, error.code, error.$metadata)
    return {
      success: false,
      key,
      error: error.message,
    }
  }
}

/**
 * Explicit buffer-upload seam for server-side ingestion jobs.
 * Keep uploadToR2 as the compatible public implementation.
 */
export const uploadBufferToR2 = (params: Parameters<typeof uploadToR2>[0]) =>
  uploadToR2(params)

/**
 * 从 R2 删除文件
 */
export const deleteFromR2 = async (
  key: string,
): Promise<{
  success: boolean
  error?: string
}> => {
  try {
    const client = getS3Client()

    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    })

    await client.send(command)
    logger.info('[R2] File deleted', getKeyLogMeta(key))

    return { success: true }
  } catch (error: any) {
    logger.error('[R2] Delete failed:', error)
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * Explicit object-cleanup seam for ingestion race losers.
 * Keep deleteFromR2 unchanged for existing callers.
 */
export const deleteR2Object = (key: string) => deleteFromR2(key)

/**
 * 从 R2 读取文件流，用于公开素材 URL 代理
 */
export const getObjectFromR2 = async (key: string) => {
  const client = getS3Client()

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  })

  return client.send(command)
}

/**
 * 检查 R2 配置是否完整
 */
export const checkR2Config = (): {
  configured: boolean
  missing: string[]
} => {
  const missing: string[] = []

  if (!R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID')
  if (!R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID')
  if (!R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY')
  if (!R2_BUCKET_NAME) missing.push('R2_BUCKET_NAME')

  return {
    configured: missing.length === 0,
    missing,
  }
}

/**
 * 生成预签名上传 URL（用于客户端直传）
 * 客户端可以使用此 URL 直接 PUT 文件到 R2，无需经过服务器
 */
export const generatePresignedUploadUrl = async (params: {
  fileName: string
  mimeType: string
  folder?: string
  expiresIn?: number // 过期时间（秒），默认 3600（1小时）
}): Promise<{
  success: boolean
  uploadUrl?: string
  key?: string
  publicUrl?: string
  error?: string
}> => {
  const { fileName, mimeType, folder, expiresIn = 3600 } = params

  logger.info('[R2] Generating presigned URL', {
    mimeType,
    hasFolder: Boolean(folder),
    extension: path.extname(fileName).toLowerCase() || '.bin',
    expiresIn,
  })

  try {
    const client = getS3Client()
    const key = generateStorageKey(fileName, folder)

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: mimeType,
    })

    const uploadUrl = await getSignedUrl(client, command, { expiresIn })

    // 生成公开访问 URL
    const publicUrl = getPublicUrlForKey(key)

    logger.info('[R2] Presigned URL generated', getKeyLogMeta(key))

    return {
      success: true,
      uploadUrl,
      key,
      publicUrl,
    }
  } catch (error: any) {
    logger.error('[R2] Generate presigned URL failed:', error.message)
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * 批量生成预签名上传 URL
 */
export const generatePresignedUploadUrls = async (
  files: Array<{
    fileName: string
    mimeType: string
    size: number
  }>,
  folder = 'materials',
): Promise<{
  success: boolean
  urls?: Array<{
    fileName: string
    uploadUrl: string
    key: string
    publicUrl: string
  }>
  error?: string
}> => {
  logger.info(`[R2] Generating presigned URLs for ${files.length} files`)

  try {
    const results = await Promise.all(
      files.map(async (file, index) => {
        const result = await generatePresignedUploadUrl({
          fileName: file.fileName,
          mimeType: file.mimeType,
          folder,
        })

        if (!result.success) {
          throw new Error(
            `Failed to generate URL for file #${index + 1}: ${result.error}`,
          )
        }

        return {
          fileName: file.fileName,
          uploadUrl: result.uploadUrl!,
          key: result.key!,
          publicUrl: result.publicUrl!,
        }
      }),
    )

    return {
      success: true,
      urls: results,
    }
  } catch (error: any) {
    logger.error('[R2] Generate presigned URLs failed:', error.message)
    return {
      success: false,
      error: error.message,
    }
  }
}

export default {
  uploadToR2,
  uploadBufferToR2,
  deleteFromR2,
  deleteR2Object,
  getObjectFromR2,
  checkR2Config,
  generatePresignedUploadUrl,
  generatePresignedUploadUrls,
  getPublicUrlForKey,
}
