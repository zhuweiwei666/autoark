import { Request, Response } from 'express'
import FacebookApp from '../models/FacebookApp'
import axios from 'axios'
import logger from '../utils/logger'

/**
 * 获取所有 Facebook Apps
 */
export const getApps = async (req: Request, res: Response) => {
  try {
    const apps = await FacebookApp.find().sort({ 'config.priority': -1, createdAt: -1 })
    res.json({ success: true, data: apps })
  } catch (error: any) {
    logger.error('获取 Facebook Apps 失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取单个 App
 */
export const getApp = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const app = await FacebookApp.findById(id)
    if (!app) {
      return res.status(404).json({ success: false, error: 'App 不存在' })
    }
    res.json({ success: true, data: app })
  } catch (error: any) {
    logger.error('获取 Facebook App 失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 创建新 App
 */
export const createApp = async (req: Request, res: Response) => {
  try {
    const { appId, appSecret, appName, notes, config } = req.body

    // 检查是否已存在
    const existing = await FacebookApp.findOne({ appId })
    if (existing) {
      return res.status(400).json({ success: false, error: '该 App ID 已存在' })
    }

    // 验证 App 凭证
    const validationResult = await validateAppCredentials(appId, appSecret)

    const app = new FacebookApp({
      appId,
      appSecret,
      appName: appName || `App ${appId.substring(0, 6)}`,
      notes,
      config: config || {},
      validation: {
        isValid: validationResult.isValid,
        validatedAt: new Date(),
        validationError: validationResult.error,
      },
      status: validationResult.isValid ? 'active' : 'inactive',
      createdBy: req.user?.userId, // 记录创建者
    })

    await app.save()
    logger.info(`创建 Facebook App: ${appName || appId}`)
    res.json({ success: true, data: app })
  } catch (error: any) {
    logger.error('创建 Facebook App 失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 更新 App
 */
export const updateApp = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { appName, appSecret, notes, config, status } = req.body

    const app = await FacebookApp.findById(id)
    if (!app) {
      return res.status(404).json({ success: false, error: 'App 不存在' })
    }

    // 如果更新了 secret，重新验证
    if (appSecret && appSecret !== app.appSecret) {
      const validationResult = await validateAppCredentials(String(app.appId), String(appSecret))
      app.appSecret = appSecret
      app.validation = {
        isValid: validationResult.isValid,
        validatedAt: new Date(),
        validationError: validationResult.error,
      }
      if (!validationResult.isValid) {
        app.status = 'inactive'
      }
    }

    if (appName) app.appName = appName
    if (notes !== undefined) app.notes = notes
    if (config) app.config = { ...app.config, ...config }
    if (status) app.status = status

    await app.save()
    logger.info(`更新 Facebook App: ${app.appName}`)
    res.json({ success: true, data: app })
  } catch (error: any) {
    logger.error('更新 Facebook App 失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除 App
 */
export const deleteApp = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const app = await FacebookApp.findByIdAndDelete(id)
    if (!app) {
      return res.status(404).json({ success: false, error: 'App 不存在' })
    }
    logger.info(`删除 Facebook App: ${app.appName}`)
    res.json({ success: true, message: '删除成功' })
  } catch (error: any) {
    logger.error('删除 Facebook App 失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 验证 App 凭证
 */
export const validateApp = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const app = await FacebookApp.findById(id)
    if (!app) {
      return res.status(404).json({ success: false, error: 'App 不存在' })
    }

    const result = await validateAppCredentials(String(app.appId), String(app.appSecret))
    
    app.validation = {
      isValid: result.isValid,
      validatedAt: new Date(),
      validationError: result.error,
    }
    
    if (result.isValid && app.status === 'inactive') {
      app.status = 'active'
    } else if (!result.isValid) {
      app.status = 'inactive'
    }

    await app.save()
    res.json({ success: true, data: { ...result, app } })
  } catch (error: any) {
    logger.error('验证 Facebook App 失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取可用于任务的 Apps（按负载和优先级排序）
 */
export const getAvailableApps = async (req: Request, res: Response) => {
  try {
    const { count = 1 } = req.query
    const apps = await FacebookApp.find({
      status: 'active',
      'validation.isValid': true,
    }).sort({
      'currentLoad.activeTasks': 1,
      'config.priority': -1,
    }).limit(Number(count))

    res.json({ success: true, data: apps })
  } catch (error: any) {
    logger.error('获取可用 Apps 失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 App 统计信息
 */
export const getAppStats = async (req: Request, res: Response) => {
  try {
    const apps = await FacebookApp.find()
    
    const stats = {
      total: apps.length,
      active: apps.filter(a => a.status === 'active').length,
      inactive: apps.filter(a => a.status === 'inactive').length,
      rateLimited: apps.filter(a => a.status === 'rate_limited').length,
      totalRequests: apps.reduce((sum, a) => sum + Number(a.stats?.totalRequests || 0), 0),
      avgHealthScore: apps.length > 0 
        ? Math.round(apps.reduce((sum, a) => {
            const total = Number(a.stats?.totalRequests || 1)
            const success = Number(a.stats?.successRequests || 0)
            return sum + (success / total) * 100
          }, 0) / apps.length)
        : 100,
    }

    res.json({ success: true, data: stats })
  } catch (error: any) {
    logger.error('获取 App 统计失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 重置 App 统计
 */
export const resetAppStats = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const app = await FacebookApp.findById(id)
    if (!app) {
      return res.status(404).json({ success: false, error: 'App 不存在' })
    }

    app.stats = {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      lastUsedAt: undefined,
      lastErrorAt: undefined,
      lastError: undefined,
      rateLimitResetAt: undefined,
    }
    app.currentLoad = {
      activeTasks: 0,
      requestsThisMinute: 0,
      lastResetAt: new Date(),
    }

    await app.save()
    res.json({ success: true, data: app })
  } catch (error: any) {
    logger.error('重置 App 统计失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 内部函数：验证 App 凭证
 */
async function validateAppCredentials(appId: string, appSecret: string): Promise<{ isValid: boolean; error?: string; details?: any }> {
  try {
    // 获取 app access token
    const response = await axios.get(
      `https://graph.facebook.com/oauth/access_token`,
      {
        params: {
          client_id: appId,
          client_secret: appSecret,
          grant_type: 'client_credentials',
        },
        timeout: 10000,
      }
    )

    if (response.data?.access_token) {
      // 进一步验证 token
      const debugResponse = await axios.get(
        `https://graph.facebook.com/debug_token`,
        {
          params: {
            input_token: response.data.access_token,
            access_token: response.data.access_token,
          },
          timeout: 10000,
        }
      )

      return {
        isValid: true,
        details: {
          appId: debugResponse.data?.data?.app_id,
          isValid: debugResponse.data?.data?.is_valid,
        },
      }
    }

    return { isValid: false, error: '无法获取 access token' }
  } catch (error: any) {
    const errorMessage = error.response?.data?.error?.message || error.message
    logger.error(`验证 App ${appId} 失败:`, errorMessage)
    return { isValid: false, error: errorMessage }
  }
}

/**
 * 导出供其他服务使用的函数
 */
export async function getNextAvailableApp(): Promise<any> {
  const app = await FacebookApp.findOne({
    status: 'active',
    'validation.isValid': true,
  }).sort({
    'currentLoad.activeTasks': 1,
    'config.priority': -1,
  })
  
  return app
}

export async function incrementAppLoad(appId: string): Promise<void> {
  await FacebookApp.updateOne(
    { appId },
    { 
      $inc: { 'currentLoad.activeTasks': 1 },
      $set: { 'stats.lastUsedAt': new Date() }
    }
  )
}

export async function decrementAppLoad(appId: string): Promise<void> {
  await FacebookApp.updateOne(
    { appId },
    { $inc: { 'currentLoad.activeTasks': -1 } }
  )
}

export async function recordAppRequest(appId: string, success: boolean, error?: string): Promise<void> {
  const update: any = {
    $inc: { 
      'stats.totalRequests': 1,
      'stats.successRequests': success ? 1 : 0,
      'stats.failedRequests': success ? 0 : 1,
    }
  }

  if (!success && error) {
    update.$set = {
      'stats.lastErrorAt': new Date(),
      'stats.lastError': error,
    }
    
    // 检查是否是限流错误
    if (error.includes('rate limit') || error.includes('too many')) {
      update.$set['status'] = 'rate_limited'
      update.$set['stats.rateLimitResetAt'] = new Date(Date.now() + 60 * 60 * 1000) // 1小时后重置
    }
  }

  await FacebookApp.updateOne({ appId }, update)
}

