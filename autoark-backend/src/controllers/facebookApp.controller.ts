import { Request, Response } from 'express'
import FacebookApp from '../models/FacebookApp'
import axios from 'axios'
import logger from '../utils/logger'
import { FB_BASE_URL, FB_OAUTH_URL } from '../config/facebook.config'
import { writeAuditLog } from '../services/auditLog.service'
import {
  PUBLIC_OAUTH_REQUIRED_PERMISSIONS,
  buildPublicOAuthReadiness,
  computePublicOauthComplianceReady,
} from '../utils/facebookAppReadiness'
import { parseLimitedNumber, pickSafeQueryString } from '../utils/pagination'

const APP_ID_MAX_LENGTH = 80
const APP_SECRET_MAX_LENGTH = 256
const APP_NAME_MAX_LENGTH = 100
const APP_NOTES_MAX_LENGTH = 500
const BUSINESS_LOGIN_CONFIG_ID_MAX_LENGTH = 80
const PERMISSION_NAME_MAX_LENGTH = 100
const PERMISSION_NOTES_MAX_LENGTH = 500
const MAX_APP_CONCURRENT_TASKS = 100
const MAX_APP_REQUESTS_PER_MINUTE = 100000
const MAX_APP_PRIORITY = 1000
const MAX_PERMISSION_ROWS = 100

const FACEBOOK_APP_STATUSES = ['active', 'inactive', 'suspended', 'rate_limited'] as const
const APP_MODES = ['dev', 'live', 'unknown'] as const
const BUSINESS_VERIFICATION_STATUSES = ['not_started', 'in_review', 'verified', 'rejected', 'unknown'] as const
const APP_REVIEW_STATUSES = ['not_started', 'in_review', 'approved', 'rejected', 'unknown'] as const
const PERMISSION_ACCESS_LEVELS = ['standard', 'advanced', 'unknown'] as const
const PERMISSION_STATUSES = ['requested', 'approved', 'rejected', 'unknown'] as const

const writeFacebookAppAudit = (req: Request, input: {
  action: string
  status?: 'success' | 'failed' | 'warning'
  targetId?: string
  summary?: string
  reason?: string
  metadata?: any
}) => writeAuditLog(req, {
  category: 'facebook_app',
  targetType: 'facebook_app',
  organizationId: req.user?.organizationId,
  userId: req.user?.userId,
  ...input,
})

const complianceAuditMetadata = (app: any) => {
  const permissions = Array.isArray(app?.compliance?.permissions) ? app.compliance.permissions : []
  const readiness = buildPublicOAuthReadiness(app)
  return {
    appId: app?.appId,
    appMode: app?.compliance?.appMode,
    businessVerification: app?.compliance?.businessVerification,
    appReview: app?.compliance?.appReview,
    publicOauthReady: Boolean(app?.compliance?.publicOauthReady),
    publicOauthRuntimeReady: readiness.ready,
    publicOauthGapCodes: readiness.gaps.map((gap) => gap.code),
    permissionCount: permissions.length,
    approvedAdvancedPermissions: permissions.filter((permission: any) => (
      permission.access === 'advanced' && permission.status === 'approved'
    )).length,
  }
}

const assignableBulkAdAppQuery: Record<string, any> = {
  status: 'active',
  'validation.isValid': true,
  'config.enabledForBulkAds': { $ne: false },
}

const AVAILABLE_APP_DEFAULT_LIMIT = 1
const AVAILABLE_APP_MAX_LIMIT = 50

const isPlainObject = (value: any): value is Record<string, any> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const hasOwn = (target: any, key: string): boolean => (
  Boolean(target) && Object.prototype.hasOwnProperty.call(target, key)
)

const boundedInteger = (value: any, max: number): number | undefined => {
  const next = Number(value)
  if (!Number.isFinite(next) || next < 0) return undefined
  return Math.min(max, Math.floor(next))
}

const pickAllowed = <T extends readonly string[]>(value: any, allowed: T): T[number] | undefined => {
  if (typeof value !== 'string') return undefined
  return allowed.includes(value as T[number]) ? value as T[number] : undefined
}

const sanitizeFacebookAppConfig = (config: any): Record<string, any> | undefined => {
  if (!isPlainObject(config)) return undefined

  const sanitized: Record<string, any> = {}
  const maxConcurrentTasks = boundedInteger(config.maxConcurrentTasks, MAX_APP_CONCURRENT_TASKS)
  const requestsPerMinute = boundedInteger(config.requestsPerMinute, MAX_APP_REQUESTS_PER_MINUTE)
  const priority = boundedInteger(config.priority, MAX_APP_PRIORITY)
  const businessLoginConfigId = pickSafeQueryString(config.businessLoginConfigId, BUSINESS_LOGIN_CONFIG_ID_MAX_LENGTH)

  if (maxConcurrentTasks !== undefined) sanitized.maxConcurrentTasks = maxConcurrentTasks
  if (requestsPerMinute !== undefined) sanitized.requestsPerMinute = requestsPerMinute
  if (priority !== undefined) sanitized.priority = priority
  if (typeof config.enabledForBulkAds === 'boolean') sanitized.enabledForBulkAds = config.enabledForBulkAds
  if (
    hasOwn(config, 'businessLoginConfigId') &&
    (typeof config.businessLoginConfigId === 'string' || config.businessLoginConfigId === null)
  ) {
    sanitized.businessLoginConfigId = businessLoginConfigId
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

const sanitizePermissions = (permissions: any): any[] | undefined => {
  if (!Array.isArray(permissions)) return undefined

  const seen = new Set<string>()
  return permissions
    .slice(0, MAX_PERMISSION_ROWS)
    .map((permission) => {
      if (!isPlainObject(permission)) return undefined
      const name = pickSafeQueryString(permission.name, PERMISSION_NAME_MAX_LENGTH)
      if (!name || seen.has(name)) return undefined
      seen.add(name)

      return {
        name,
        access: pickAllowed(permission.access, PERMISSION_ACCESS_LEVELS) || 'unknown',
        status: pickAllowed(permission.status, PERMISSION_STATUSES) || 'unknown',
        notes: pickSafeQueryString(permission.notes, PERMISSION_NOTES_MAX_LENGTH),
        lastUpdatedAt: new Date(),
      }
    })
    .filter(Boolean) as any[]
}

const sanitizeFacebookAppCompliance = (compliance: any): Record<string, any> | undefined => {
  if (!isPlainObject(compliance)) return undefined

  const sanitized: Record<string, any> = {}
  const appMode = pickAllowed(compliance.appMode, APP_MODES)
  const businessVerification = pickAllowed(compliance.businessVerification, BUSINESS_VERIFICATION_STATUSES)
  const appReview = pickAllowed(compliance.appReview, APP_REVIEW_STATUSES)
  const permissions = sanitizePermissions(compliance.permissions)

  if (appMode) sanitized.appMode = appMode
  if (businessVerification) sanitized.businessVerification = businessVerification
  if (appReview) sanitized.appReview = appReview
  if (permissions) sanitized.permissions = permissions

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

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
    const appId = pickSafeQueryString(req.body?.appId, APP_ID_MAX_LENGTH)
    const appSecret = pickSafeQueryString(req.body?.appSecret, APP_SECRET_MAX_LENGTH)
    const appName = pickSafeQueryString(req.body?.appName, APP_NAME_MAX_LENGTH)
    const notes = pickSafeQueryString(req.body?.notes, APP_NOTES_MAX_LENGTH)
    const config = sanitizeFacebookAppConfig(req.body?.config) || {}

    if (!appId || !appSecret) {
      return res.status(400).json({ success: false, error: 'App ID 和 App Secret 不能为空' })
    }

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
      config,
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
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.create',
      targetId: String(app._id),
      summary: `创建 Facebook App：${app.appName}`,
      metadata: {
        appId: app.appId,
        validationIsValid: app.validation?.isValid,
        status: app.status,
      },
    })
    res.json({ success: true, data: app })
  } catch (error: any) {
    logger.error('创建 Facebook App 失败:', error)
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.create',
      status: 'failed',
      summary: '创建 Facebook App 失败',
      reason: error.message,
      metadata: {
        appId: pickSafeQueryString(req.body?.appId, APP_ID_MAX_LENGTH),
      },
    })
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 更新 App
 */
export const updateApp = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const appName = pickSafeQueryString(req.body?.appName, APP_NAME_MAX_LENGTH)
    const appSecret = pickSafeQueryString(req.body?.appSecret, APP_SECRET_MAX_LENGTH)
    const notes = pickSafeQueryString(req.body?.notes, APP_NOTES_MAX_LENGTH)
    const config = sanitizeFacebookAppConfig(req.body?.config)
    const status = pickAllowed(req.body?.status, FACEBOOK_APP_STATUSES)
    const compliance = sanitizeFacebookAppCompliance(req.body?.compliance)

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
    if (hasOwn(req.body, 'notes') && (typeof req.body.notes === 'string' || req.body.notes === null)) {
      app.notes = notes
    }
    if (config) {
      const existingConfig = typeof (app.config as any)?.toObject === 'function'
        ? (app.config as any).toObject()
        : (app.config as any || {})
      app.config = { ...existingConfig, ...config }
    }
    if (status) app.status = status

    // 合规信息允许更新（用于记录 Advanced Access / Business Verification / App Review 状态）
    if (compliance) {
      app.compliance = {
        ...(app.compliance as any),
        ...compliance,
        // 如果传入 permissions，覆盖；否则保留原来的
        ...(compliance.permissions ? { permissions: compliance.permissions } : {}),
      } as any
      ;(app.compliance as any).publicOauthReady = computePublicOauthComplianceReady(app)
      ;(app.compliance as any).lastCheckedAt = new Date()
    }
    if (app.compliance) {
      ;(app.compliance as any).publicOauthReady = computePublicOauthComplianceReady(app)
      ;(app.compliance as any).lastCheckedAt = new Date()
    }

    await app.save()
    logger.info(`更新 Facebook App: ${app.appName}`)
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.update',
      targetId: String(app._id),
      summary: `更新 Facebook App：${app.appName}`,
      metadata: {
        appId: app.appId,
        status: app.status,
        validationIsValid: app.validation?.isValid,
        publicOauthReady: app.compliance?.publicOauthReady,
      },
    })
    res.json({ success: true, data: app })
  } catch (error: any) {
    logger.error('更新 Facebook App 失败:', error)
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.update',
      status: 'failed',
      targetId: req.params.id,
      summary: '更新 Facebook App 失败',
      reason: error.message,
    })
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 返回平台“公开 OAuth”权限要求（用于前端展示/自检）
 */
export const getPublicOAuthRequirements = async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      requiredPermissions: PUBLIC_OAUTH_REQUIRED_PERMISSIONS,
      criteria: [
        'App must be active and App Secret validation must pass.',
        'App Mode must be Live.',
        'Business Verification must be verified.',
        'App Review must be approved.',
        'All required permissions must be Advanced + Approved.',
        'Facebook Login for Business config_id must be configured globally or on the App.',
      ],
      rule: 'Public customer OAuth is ready only when the App is active, valid, Live, verified, approved, has Advanced + Approved permissions, and has a Business Login config_id.',
    },
  })
}

/**
 * 快速更新某个 App 的合规信息（只写 compliance）
 * PUT /api/facebook-apps/:id/compliance
 */
export const updateCompliance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const compliance = sanitizeFacebookAppCompliance(req.body)
    const app: any = await FacebookApp.findById(id)
    if (!app) {
      return res.status(404).json({ success: false, error: 'App 不存在' })
    }

    if (!compliance) {
      return res.status(400).json({ success: false, error: '未提供有效的合规信息' })
    }

    app.compliance = {
      ...(app.compliance || {}),
      ...compliance,
      ...(compliance.permissions ? { permissions: compliance.permissions } : {}),
    }
    app.compliance.publicOauthReady = computePublicOauthComplianceReady(app)
    app.compliance.lastCheckedAt = new Date()

    await app.save()
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.compliance_update',
      targetId: String(app._id),
      summary: `更新 Facebook App 合规信息：${app.appName}`,
      metadata: complianceAuditMetadata(app),
    })
    res.json({ success: true, data: app })
  } catch (error: any) {
    logger.error('更新 App 合规信息失败:', error)
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.compliance_update',
      status: 'failed',
      targetId: req.params.id,
      summary: '更新 Facebook App 合规信息失败',
      reason: error.message,
    })
    res.status(500).json({ success: false, error: error.message })
  }
}

const refreshReadinessForApp = async (app: any) => {
  const result = await validateAppCredentials(String(app.appId), String(app.appSecret))
  const checkedAt = new Date()

  app.validation = {
    isValid: result.isValid,
    validatedAt: checkedAt,
    validationError: result.error,
  }

  if (result.isValid && app.status === 'inactive') {
    app.status = 'active'
  } else if (!result.isValid) {
    app.status = 'inactive'
  }

  app.compliance = {
    ...(app.compliance || {}),
    publicOauthReady: computePublicOauthComplianceReady(app),
    lastCheckedAt: checkedAt,
  }

  const readiness = buildPublicOAuthReadiness(app)
  await app.save()

  return { ...result, app, readiness }
}

/**
 * 实时刷新所有 App 的公开授权就绪度
 * POST /api/facebook-apps/refresh-readiness
 */
export const refreshAppsReadiness = async (req: Request, res: Response) => {
  try {
    const apps: any[] = await FacebookApp.find()
    const results = await Promise.all(apps.map(async (app) => {
      try {
        const result = await refreshReadinessForApp(app)
        return {
          app,
          isValid: result.isValid,
          readiness: result.readiness,
          error: result.error,
        }
      } catch (error: any) {
        return {
          app,
          isValid: false,
          readiness: buildPublicOAuthReadiness(app),
          error: error.message,
        }
      }
    }))
    const failed = results.filter((result) => result.error).length

    await writeFacebookAppAudit(req, {
      action: 'facebook_app.validate',
      status: failed > 0 ? 'warning' : 'success',
      summary: `实时刷新 Facebook App 就绪度：${apps.length - failed}/${apps.length} 成功`,
      metadata: {
        appCount: apps.length,
        refreshed: apps.length - failed,
        failed,
      },
    })

    res.json({
      success: true,
      data: {
        apps,
        results,
        refreshed: apps.length - failed,
        failed,
      },
    })
  } catch (error: any) {
    logger.error('实时刷新 Facebook App 就绪度失败:', error)
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.validate',
      status: 'failed',
      summary: '实时刷新 Facebook App 就绪度失败',
      reason: error.message,
    })
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 实时刷新单个 App 的公开授权就绪度
 * POST /api/facebook-apps/:id/refresh-readiness
 */
export const refreshAppReadiness = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const app: any = await FacebookApp.findById(id)
    if (!app) {
      return res.status(404).json({ success: false, error: 'App 不存在' })
    }

    const result = await refreshReadinessForApp(app)
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.validate',
      status: result.isValid ? 'success' : 'failed',
      targetId: String(app._id),
      summary: result.isValid ? `实时刷新 Facebook App 就绪度成功：${app.appName}` : `实时刷新 Facebook App 就绪度失败：${app.appName}`,
      reason: result.error,
      metadata: {
        appId: app.appId,
        validationIsValid: result.isValid,
        publicOauthReady: result.readiness.ready,
        publicOauthGapCodes: result.readiness.gaps.map((gap) => gap.code),
      },
    })

    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('实时刷新 Facebook App 就绪度失败:', error)
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.validate',
      status: 'failed',
      targetId: req.params.id,
      summary: '实时刷新 Facebook App 就绪度失败',
      reason: error.message,
    })
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
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.delete',
      targetId: String(app._id),
      summary: `删除 Facebook App：${app.appName}`,
      metadata: {
        appId: app.appId,
      },
    })
    res.json({ success: true, message: '删除成功' })
  } catch (error: any) {
    logger.error('删除 Facebook App 失败:', error)
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.delete',
      status: 'failed',
      targetId: req.params.id,
      summary: '删除 Facebook App 失败',
      reason: error.message,
    })
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
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.validate',
      status: result.isValid ? 'success' : 'failed',
      targetId: String(app._id),
      summary: result.isValid ? `验证 Facebook App 成功：${app.appName}` : `验证 Facebook App 失败：${app.appName}`,
      reason: result.error,
      metadata: {
        appId: app.appId,
        validationIsValid: result.isValid,
      },
    })
    res.json({ success: true, data: { ...result, app } })
  } catch (error: any) {
    logger.error('验证 Facebook App 失败:', error)
    await writeFacebookAppAudit(req, {
      action: 'facebook_app.validate',
      status: 'failed',
      targetId: req.params.id,
      summary: '验证 Facebook App 失败',
      reason: error.message,
    })
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取可用于任务的 Apps（按负载和优先级排序）
 */
export const getAvailableApps = async (req: Request, res: Response) => {
  try {
    const count = parseLimitedNumber(req.query.count, AVAILABLE_APP_DEFAULT_LIMIT, AVAILABLE_APP_MAX_LIMIT)
    const apps = await FacebookApp.find(assignableBulkAdAppQuery).sort({
      'currentLoad.activeTasks': 1,
      'config.priority': -1,
    }).limit(count)

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
      `${FB_OAUTH_URL}/access_token`,
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
        `${FB_BASE_URL}/debug_token`,
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
  const app = await FacebookApp.findOne(assignableBulkAdAppQuery).sort({
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
