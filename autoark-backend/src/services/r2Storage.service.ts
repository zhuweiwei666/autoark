import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
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
  
  try {
    const client = getS3Client()
    const key = generateStorageKey(originalName, folder)
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
    
    await client.send(command)
    
    // 生成公开访问 URL
    const url = R2_PUBLIC_URL 
      ? `${R2_PUBLIC_URL}/${key}`
      : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`
    
    logger.info(`[R2] File uploaded: ${key}`)
    
    return {
      success: true,
      key,
      url,
    }
  } catch (error: any) {
    logger.error('[R2] Upload failed:', error)
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

export default {
  uploadToR2,
  deleteFromR2,
  checkR2Config,
}

