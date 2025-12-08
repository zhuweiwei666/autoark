import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
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
  const prefix = folder ? `${folder}/` : 'uploads/'
  return `${prefix}${date}/${uuid}${ext}`
}

/**
 * 上传文件到 R2
 */
export const uploadToR2 = async (params: {
  buffer: Buffer
  originalName: string
  mimeType: string
  folder?: string
}): Promise<{
  success: boolean
  key?: string
  url?: string
  error?: string
}> => {
  const { buffer, originalName, mimeType, folder } = params
  
  logger.info(`[R2] Starting upload: ${originalName}, size: ${buffer.length}, type: ${mimeType}, folder: ${folder}`)
  
  try {
    logger.info(`[R2] Getting S3 client...`)
    const client = getS3Client()
    const key = generateStorageKey(originalName, folder)
    
    logger.info(`[R2] Generated key: ${key}, bucket: ${R2_BUCKET_NAME}`)
    logger.info(`[R2] Endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
    
    logger.info(`[R2] Sending to R2...`)
    const startTime = Date.now()
    await client.send(command)
    const duration = Date.now() - startTime
    logger.info(`[R2] Upload completed in ${duration}ms`)
    
    // 生成公开访问 URL
    const url = R2_PUBLIC_URL 
      ? `${R2_PUBLIC_URL}/${key}`
      : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`
    
    logger.info(`[R2] File uploaded: ${key}, URL: ${url}`)
    
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
      error: error.message,
    }
  }
}

/**
 * 从 R2 删除文件
 */
export const deleteFromR2 = async (key: string): Promise<{
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
    logger.info(`[R2] File deleted: ${key}`)
    
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
  
  logger.info(`[R2] Generating presigned URL for: ${fileName}, type: ${mimeType}`)
  
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
    const publicUrl = R2_PUBLIC_URL 
      ? `${R2_PUBLIC_URL}/${key}`
      : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`
    
    logger.info(`[R2] Presigned URL generated for: ${key}`)
    
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
export const generatePresignedUploadUrls = async (files: Array<{
  fileName: string
  mimeType: string
  size: number
}>): Promise<{
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
      files.map(async (file) => {
        const result = await generatePresignedUploadUrl({
          fileName: file.fileName,
          mimeType: file.mimeType,
          folder: 'materials',
        })
        
        if (!result.success) {
          throw new Error(`Failed to generate URL for ${file.fileName}: ${result.error}`)
        }
        
        return {
          fileName: file.fileName,
          uploadUrl: result.uploadUrl!,
          key: result.key!,
          publicUrl: result.publicUrl!,
        }
      })
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
  deleteFromR2,
  checkR2Config,
  generatePresignedUploadUrl,
  generatePresignedUploadUrls,
}

